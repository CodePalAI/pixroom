/**
 * pixroom proxy — the Node front door (planning/end_product.md §4.2–§4.3).
 *
 * Owns upstream transport, streaming, and (via the optical stage) the single
 * Anthropic `cache_control` breakpoint. For transformable POSTs it parses the body,
 * runs the ContentRouter (semantic → optical), and forwards the transformed body;
 * everything else is proxied through untouched. Responses stream straight back —
 * neither engine rewrites model output. On any transform error it forwards the
 * ORIGINAL body, so the proxy never fails closed.
 *
 * API keys are forwarded from the client to the upstream; pixroom holds none, and
 * the headroom sidecar (loopback `/v1/compress`) never sees keys or the response.
 */

import http from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';

import type { PixroomConfigOverrides } from '../config.js';
import { createRuntime, type Pixroom, type RuntimeOptions } from '../pixroom.js';
import { readModel } from '../anthropic.js';
import { CcrRetrievalOutputIntegration } from '../output/ccr.js';
import { OutputIntegrationRegistry } from '../output/registry.js';
import type { OutputIntegration } from '../output/types.js';
import { createBuiltinProtocolRegistry } from '../protocols/json.js';
import type { ProtocolRegistry } from '../protocols/registry.js';
import { createResponseEventDecoder } from '../protocols/response-events.js';
import { classifyAuthMode } from './auth-mode.js';
import type { Provider } from '../types.js';

/** Request headers we must not forward verbatim (hop-by-hop + recomputed).
 *  Note: `accept-encoding` is deliberately preserved so the forwarded request
 *  stays native-looking for stealth (oauth/subscription) traffic. */
const STRIP_REQUEST_HEADERS = new Set([
  'host',
  'content-length',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** Response hop-by-hop headers; body encoding/length stay raw with native forwarding. */
const STRIP_RESPONSE_HEADERS = new Set([
  'transfer-encoding',
  'connection',
  'keep-alive',
]);

/** Buffered uploads reuse Undici connections efficiently; stream only large/unknown bodies. */
const PASSTHROUGH_BUFFER_LIMIT_BYTES = 2_000_000;

function shouldBufferPassthrough(headers: http.IncomingHttpHeaders): boolean {
  const raw = headers['content-length'];
  if (Array.isArray(raw)) return false;
  const length = raw == null ? Number.NaN : Number(raw);
  return Number.isFinite(length) && length >= 0 && length <= PASSTHROUGH_BUFFER_LIMIT_BYTES;
}

function detectProvider(pathname: string, headers: http.IncomingHttpHeaders): Provider {
  if (headers['x-api-key'] != null || headers['anthropic-version'] != null) return 'anthropic';
  if (pathname.includes('/chat/completions') || pathname.includes('/responses')) return 'openai';
  if (pathname.includes('/messages')) return 'anthropic';
  const auth = headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return 'openai';
  return 'anthropic';
}

function readBody(req: http.IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

function requestHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v == null || STRIP_REQUEST_HEADERS.has(k.toLowerCase())) continue;
    out[k] = Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}

function responseHeaders(
  headers: http.IncomingHttpHeaders,
): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value == null || STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) continue;
    out[key] = Array.isArray(value) ? [...value] : value;
  }
  return out;
}

export interface ProxyServer {
  readonly pixroom: Pixroom;
  listen(): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
}

export interface ProxyServerOptions {
  readonly runtime?: Omit<RuntimeOptions, 'config'>;
  readonly protocols?: ProtocolRegistry;
  readonly outputIntegrations?: readonly OutputIntegration[];
}

export function createProxyServer(
  overrides: PixroomConfigOverrides = {},
  options: ProxyServerOptions = {},
): ProxyServer {
  const pixroom = createRuntime({ config: overrides, ...options.runtime });
  const { config, log } = pixroom;
  const protocols = options.protocols ?? createBuiltinProtocolRegistry();
  const outputs = new OutputIntegrationRegistry((id, error) =>
    log.warn(`output integration ${id} degraded: ${error}`),
  ).register(new CcrRetrievalOutputIntegration(pixroom.ccr));
  for (const integration of options.outputIntegrations ?? []) outputs.register(integration);
  const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 256, maxFreeSockets: 64 });
  const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 256, maxFreeSockets: 64 });

  const server = http.createServer((req, res) => {
    void handle(req, res).catch((err) => {
      log.error(`unhandled proxy error: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { type: 'pixroom_error', message: 'internal error' } }));
      }
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;

    if (req.method === 'GET' && pathname === '/health') return sendHealth(res);
    if (req.method === 'GET' && (pathname === '/stats' || pathname === '/')) return sendStats(res);

    const protocol = protocols.match({ method: req.method, pathname });
    const provider = protocol?.provider ?? detectProvider(pathname, req.headers);
    let outBytes: Uint8Array | undefined;

    if (protocol && pixroom.requestOptimizationEnabled) {
      const bodyBytes = await readBody(req);
      outBytes = bodyBytes;
      if (bodyBytes.byteLength > 0) {
        try {
          const parsed = protocol.decodeRequest(bodyBytes);
          protocol.validateRequest(parsed);
          const model = readModel(parsed);
          const authMode = classifyAuthMode(req.headers);
          const routed = await pixroom.route(provider, model, parsed, authMode);
          protocol.validateRequest(routed.body);
          outBytes = protocol.encodeRequest(routed.body);
        } catch (err) {
          // Never fail closed — forward the original request.
          log.warn(`transform failed, forwarding original: ${err instanceof Error ? err.message : String(err)}`);
          outBytes = bodyBytes;
        }
      }
    } else if (shouldBufferPassthrough(req.headers)) {
      outBytes = await readBody(req);
    }

    await forward(
      req,
      res,
      provider,
      pathname + url.search,
      outBytes,
      protocol?.id,
      randomUUID(),
    );
  }

  async function forward(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    provider: Provider,
    pathAndQuery: string,
    bodyBytes: Uint8Array | undefined,
    protocolId: string | undefined,
    exchangeId: string,
  ): Promise<void> {
    const base = config.upstreams[provider].replace(/\/+$/, '');
    const target = `${base}${pathAndQuery}`;
    const method = req.method ?? 'GET';
    const hasBody = method !== 'GET' && method !== 'HEAD';
    const targetUrl = new URL(target);
    const transport = targetUrl.protocol === 'https:' ? https : http;
    const agent = targetUrl.protocol === 'https:' ? httpsAgent : httpAgent;
    const headers = requestHeaders(req.headers);
    if (bodyBytes !== undefined) headers['content-length'] = String(bodyBytes.byteLength);

    await new Promise<void>((resolve) => {
      const upstreamRequest = transport.request(
        targetUrl,
        { method, headers, agent },
        (upstream) => {
          res.writeHead(upstream.statusCode ?? 502, responseHeaders(upstream.headers));
          const encoding = upstream.headers['content-encoding'];
          const observe =
            encoding == null &&
            (pixroom.ccr.hasOffloaded() || (options.outputIntegrations?.length ?? 0) > 0);
          if (observe) {
            const eventContext = { exchangeId, provider, protocolId, pathname: pathAndQuery };
            const contentType = upstream.headers['content-type'];
            const decoder = createResponseEventDecoder({
              provider,
              contentType: Array.isArray(contentType) ? contentType[0] : contentType,
              onEvent: (event) => outputs.dispatch(event, eventContext),
            });
            upstream.on('data', (chunk: Buffer) => decoder.push(chunk));
            upstream.on('end', () => decoder.end());
            upstream.on('error', () => decoder.end());
          }
          upstream.pipe(res);
          resolve();
        },
      );

      const onAborted = () => upstreamRequest.destroy(new Error('client aborted'));
      req.once('aborted', onAborted);
      upstreamRequest.once('close', () => req.off('aborted', onAborted));
      upstreamRequest.once('error', (error) => {
        req.off('aborted', onAborted);
        if (!req.aborted) {
          log.error(`upstream request failed: ${error.message}`);
          if (!res.headersSent) {
            res.writeHead(502, { 'content-type': 'application/json' });
            res.end(
              JSON.stringify({ error: { type: 'upstream_error', message: 'failed to reach upstream' } }),
            );
          } else {
            res.destroy(error);
          }
        }
        resolve();
      });

      if (!hasBody) {
        upstreamRequest.end();
      } else if (bodyBytes !== undefined) {
        upstreamRequest.end(bodyBytes);
      } else {
        req.pipe(upstreamRequest);
      }
    });
  }

  function sendHealth(res: http.ServerResponse): void {
    const body = {
      status: 'ok',
      mode: config.mode,
      optical: { enabled: config.optical.enabled },
      semantic: { enabled: config.semantic.enabled, sidecar: pixroom.sidecar.status, url: pixroom.sidecar.url },
      integrations: pixroom.integrations.list().map((integration) => ({
        id: integration.id,
        version: integration.version,
        regions: integration.capabilities.regions,
        fidelity: integration.capabilities.fidelity,
      })),
      protocols: protocols.list().map((protocol) => protocol.id),
      upstreams: config.upstreams,
    };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  function sendStats(res: http.ServerResponse): void {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(pixroom.stats(), null, 2));
  }

  return {
    pixroom,
    async listen() {
      await pixroom.warmup();
      await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
      const address = server.address();
      const port = typeof address === 'object' && address != null ? address.port : config.port;
      log.info(`pixroom proxy listening on http://${config.host}:${port}`);
      log.info(`  mode: ${config.mode}`);
      log.info(`  anthropic → ${config.upstreams.anthropic}`);
      log.info(`  openai    → ${config.upstreams.openai}`);
      log.info(`  semantic sidecar: ${pixroom.sidecar.status} (${pixroom.sidecar.url})`);
      return { host: config.host, port };
    },
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      httpAgent.destroy();
      httpsAgent.destroy();
      await pixroom.shutdown();
    },
  };
}
