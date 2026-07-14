import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import { createPixroom } from '../src/pixroom.js';
import { createProxyServer, type ProxyServer } from '../src/proxy/server.js';

const SYSTEM = (
  'You are a coding agent. Read files before editing, preserve exact identifiers, and verify changes. '
).repeat(400);

function body(): Record<string, unknown> {
  return {
    model: 'gpt-5',
    instructions: SYSTEM,
    input: 'Reply with exactly OK.',
    stream: false,
  };
}

const proxies: ProxyServer[] = [];
const upstreams: http.Server[] = [];

afterEach(async () => {
  await Promise.all(proxies.splice(0).map((proxy) => proxy.close()));
  await Promise.all(
    upstreams.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

describe('OpenAI Responses support', () => {
  it('optimizes a Responses body through the runtime integration pipeline', async () => {
    const runtime = createPixroom({
      semantic: { enabled: false },
      optical: { enabled: true, allowedModelBases: ['gpt-5'] },
      logLevel: 'silent',
    });
    const routed = await runtime.route('openai', 'gpt-5', body(), 'payg');
    const row = routed.report.rows.find((item) => item.stage === 'optical');

    expect(row?.applied).toBe(true);
    expect(row?.tokensSaved).toBeGreaterThan(0);
    expect(routed.opticalOwnsCacheControl).toBe(false);
    expect(routed.body.instructions).not.toBe(SYSTEM);
    const input = routed.body.input as Array<{ content?: Array<{ type?: string }> }>;
    expect(input.some((item) => item.content?.some((part) => part.type === 'input_image'))).toBe(
      true,
    );
    expect(JSON.stringify(routed.body)).toContain('Reply with exactly OK.');
    await runtime.shutdown();
  });

  it('transforms POST /v1/responses before forwarding and passes the response through', async () => {
    let forwarded: Record<string, unknown> | undefined;
    const upstream = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        forwarded = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'resp_test', output_text: 'OK' }));
      });
    });
    upstreams.push(upstream);
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;

    const proxy = createProxyServer({
      port: 0,
      upstreams: { openai: `http://127.0.0.1:${upstreamPort}` },
      semantic: { enabled: false },
      optical: { enabled: true, allowedModelBases: ['gpt-5'] },
      logLevel: 'silent',
    });
    proxies.push(proxy);
    const { port } = await proxy.listen();
    const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: 'POST',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: JSON.stringify(body()),
    });

    expect(await response.json()).toEqual({ id: 'resp_test', output_text: 'OK' });
    expect(forwarded).toBeDefined();
    expect(forwarded?.instructions).not.toBe(SYSTEM);
    expect(JSON.stringify(forwarded)).toContain('input_image');
  });

  it('keeps unsupported Responses bodies byte-equivalent', async () => {
    const runtime = createPixroom({
      semantic: { enabled: false },
      optical: { enabled: true, allowedModelBases: ['gpt-5'] },
      logLevel: 'silent',
    });
    const original = { ...body(), model: 'unsupported-model' };
    const routed = await runtime.route(
      'openai',
      'unsupported-model',
      structuredClone(original),
      'payg',
    );

    expect(routed.body).toEqual(original);
    expect(routed.report.rows.find((item) => item.stage === 'optical')).toMatchObject({
      applied: false,
      reason: 'unsupported_model',
    });
    await runtime.shutdown();
  });

  it('forwards raw bytes without JSON churn when every optimizer is disabled', async () => {
    let forwarded = '';
    const upstream = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        forwarded = Buffer.concat(chunks).toString();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      });
    });
    upstreams.push(upstream);
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    const proxy = createProxyServer({
      port: 0,
      upstreams: { openai: `http://127.0.0.1:${upstreamPort}` },
      semantic: { enabled: false },
      optical: { enabled: false },
      logLevel: 'silent',
    });
    proxies.push(proxy);
    const { port } = await proxy.listen();
    const raw = '{\n  "model": "gpt-5",\n  "input": "hello",\n  "vendor": { "z": 1, "a": 2 }\n}\n';

    await fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: 'POST',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: raw,
    });

    expect(forwarded).toBe(raw);
  });
});