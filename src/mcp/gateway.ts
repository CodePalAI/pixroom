import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

import {
  VIRTUAL_QUERY_TOOL_NAME,
  VirtualContextStore,
  type VirtualContextDescriptor,
  type VirtualContextJoinQuery,
  type VirtualContextQuery,
} from '../virtual-context/store.js';

export const MCP_QUERY_TOOL_NAME = VIRTUAL_QUERY_TOOL_NAME;
export const MCP_ARTIFACT_URI_PREFIX = 'pinpoint://artifact/';
export const DEFAULT_MCP_VIRTUALIZE_CHARS = 16_000;

type JsonPrimitive = string | number | boolean | null;

export interface McpContentBlock {
  readonly type: string;
  readonly text?: string;
  readonly uri?: string;
  readonly name?: string;
  readonly description?: string;
  readonly mimeType?: string;
  readonly [key: string]: unknown;
}

export interface McpCallToolResult {
  readonly content: readonly McpContentBlock[];
  readonly isError?: boolean;
  readonly structuredContent?: Record<string, unknown>;
  readonly _meta?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

export interface McpResultFirewallOptions {
  readonly minChars?: number;
  readonly maxResultChars?: number;
  readonly maxEntries?: number;
  readonly maxStoredBytes?: number;
}

export interface McpGatewayOptions extends McpResultFirewallOptions {
  readonly input?: Readable;
  readonly output?: Writable;
  readonly error?: Writable;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
}

export interface McpResultTransformation {
  readonly result: McpCallToolResult;
  readonly virtualized: boolean;
  readonly descriptor?: VirtualContextDescriptor;
}

export const MCP_QUERY_TOOL = {
  name: MCP_QUERY_TOOL_NAME,
  description:
    'Query an exact Pinpoint artifact without loading the full upstream MCP result. ' +
    'Use schema first when needed, then json_select, count, grep, slice, or json_join. ' +
    'Results are deterministic and bounded; narrow the query instead of requesting the full artifact.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        pattern: '^vctx_[a-f0-9]{32,64}$',
        description: 'Artifact id from a virtualized MCP result. Do not call this tool before receiving one.',
      },
      op: {
        type: 'string',
        enum: ['schema', 'json_select', 'count', 'grep', 'slice', 'json_join'],
      },
      where: {
        type: 'object',
        description: 'Exact field/value equality filters for JSON rows.',
        additionalProperties: {
          anyOf: [
            { type: 'string' },
            { type: 'number' },
            { type: 'boolean' },
            { type: 'null' },
          ],
        },
      },
      fields: {
        type: 'array',
        items: { type: 'string' },
        description: 'Fields to return from matching JSON rows.',
      },
      query: { type: 'string', description: 'Literal text for grep or line counts.' },
      offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 0, maximum: 100 },
      joinId: {
        type: 'string',
        pattern: '^vctx_[a-f0-9]{32,64}$',
        description: 'Destination artifact id for json_join.',
      },
      on: { type: 'string', description: 'Shared key-shaped field for json_join.' },
    },
    required: ['id', 'op'],
    additionalProperties: false,
  },
} as const;

const MCP_ARTIFACT_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    pinpointArtifact: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        sourceTool: { type: 'string' },
        kind: { type: 'string', enum: ['json-array', 'json-object', 'lines'] },
        bytes: { type: 'integer', minimum: 0 },
        items: { type: 'integer', minimum: 0 },
        fields: { type: 'array', items: { type: 'string' } },
        dataPath: { type: 'array', items: { type: 'string' } },
        queryTool: { type: 'string' },
      },
      required: ['id', 'sourceTool', 'kind', 'bytes', 'items', 'fields', 'queryTool'],
      additionalProperties: false,
    },
  },
  required: ['pinpointArtifact'],
  additionalProperties: false,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)))
  );
}

function exactWhere(value: unknown): Readonly<Record<string, JsonPrimitive>> | undefined {
  if (value == null) return undefined;
  if (!isRecord(value)) throw new TypeError('where must be an object of exact JSON primitive values');
  const entries = Object.entries(value);
  if (entries.length > 16 || entries.some(([, item]) => !isJsonPrimitive(item))) {
    throw new TypeError('where must contain at most 16 exact JSON primitive values');
  }
  return Object.fromEntries(entries) as Readonly<Record<string, JsonPrimitive>>;
}

function stringList(value: unknown, field: string): readonly string[] | undefined {
  if (value == null) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > 32 ||
    value.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 256)
  ) {
    throw new TypeError(`${field} must contain at most 32 non-empty strings`);
  }
  return value;
}

function optionalInteger(value: unknown, field: string): number | undefined {
  if (value == null) return undefined;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new TypeError(`${field} must be a non-negative integer`);
  }
  return value as number;
}

function parseQuery(args: Record<string, unknown>): VirtualContextQuery | VirtualContextJoinQuery {
  const id = args.id;
  const op = args.op;
  if (typeof id !== 'string' || !/^vctx_[a-f0-9]{32,64}$/.test(id)) {
    throw new TypeError('id must be a Pinpoint artifact id');
  }
  if (!['schema', 'json_select', 'count', 'grep', 'slice', 'json_join'].includes(String(op))) {
    throw new TypeError('unsupported artifact operation');
  }

  const where = exactWhere(args.where);
  const fields = stringList(args.fields, 'fields');
  const query = args.query;
  if (query != null && (typeof query !== 'string' || query.length === 0 || query.length > 512)) {
    throw new TypeError('query must be a non-empty string of at most 512 characters');
  }

  if (op === 'json_join') {
    if (
      typeof args.joinId !== 'string' ||
      !/^vctx_[a-f0-9]{32,64}$/.test(args.joinId) ||
      typeof args.on !== 'string' ||
      !where ||
      !fields?.length
    ) {
      throw new TypeError('json_join requires joinId, on, where, and fields');
    }
    return { id, op, joinId: args.joinId, on: args.on, where, fields };
  }

  return {
    id,
    op: op as VirtualContextQuery['op'],
    ...(where ? { where } : {}),
    ...(fields ? { fields } : {}),
    ...(typeof query === 'string' ? { query } : {}),
    ...(args.offset != null ? { offset: optionalInteger(args.offset, 'offset') } : {}),
    ...(args.limit != null ? { limit: optionalInteger(args.limit, 'limit') } : {}),
  };
}

function exactPayload(result: McpCallToolResult): string | undefined {
  if (result.isError === true) return undefined;
  if (isRecord(result.structuredContent)) return JSON.stringify(result.structuredContent);
  if (!Array.isArray(result.content) || result.content.length !== 1) return undefined;
  const block = result.content[0];
  if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string') return undefined;
  return block.text;
}

function artifactMimeType(descriptor: VirtualContextDescriptor): string {
  return descriptor.kind.startsWith('json-') ? 'application/json' : 'text/plain';
}

function virtualResult(
  sourceTool: string,
  descriptor: VirtualContextDescriptor,
  original: McpCallToolResult,
): McpCallToolResult {
  const artifact = {
    id: descriptor.id,
    sourceTool,
    kind: descriptor.kind,
    bytes: descriptor.bytes,
    items: descriptor.items,
    fields: descriptor.fields,
    ...(descriptor.dataPath ? { dataPath: descriptor.dataPath } : {}),
    queryTool: MCP_QUERY_TOOL_NAME,
  };
  const text = [
    `Pinpoint kept the exact ${descriptor.bytes}-byte result from ${sourceTool} outside model context.`,
    JSON.stringify(artifact),
    `Call ${MCP_QUERY_TOOL_NAME} with this id for bounded exact access; use schema when the fields are unclear.`,
  ].join('\n');

  return {
    ...original,
    content: [
      { type: 'text', text },
      {
        type: 'resource_link',
        uri: `${MCP_ARTIFACT_URI_PREFIX}${descriptor.id}`,
        name: `${sourceTool} result`,
        description: `Exact ${descriptor.kind} result retained by Pinpoint; query with ${MCP_QUERY_TOOL_NAME}.`,
        mimeType: artifactMimeType(descriptor),
      },
    ],
    structuredContent: { pinpointArtifact: artifact },
    _meta: {
      ...(isRecord(original._meta) ? original._meta : {}),
      pinpoint: { virtualized: true, artifact },
    },
  };
}

function artifactUri(id: string): string {
  return `${MCP_ARTIFACT_URI_PREFIX}${id}`;
}

function errorResult(message: string): McpCallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

export class McpResultFirewall {
  readonly store: VirtualContextStore;
  readonly minChars: number;
  private readonly descriptors = new Map<string, { descriptor: VirtualContextDescriptor; sourceTool: string }>();

  constructor(options: McpResultFirewallOptions = {}) {
    this.minChars = Math.max(1, Math.trunc(options.minChars ?? DEFAULT_MCP_VIRTUALIZE_CHARS));
    this.store = new VirtualContextStore(
      options.maxResultChars,
      options.maxEntries,
      options.maxStoredBytes,
    );
  }

  get tools(): readonly [typeof MCP_QUERY_TOOL] {
    return [MCP_QUERY_TOOL];
  }

  transformResult(sourceTool: string, result: McpCallToolResult): McpResultTransformation {
    try {
      const raw = exactPayload(result);
      if (raw == null || raw.length < this.minChars) return { result, virtualized: false };

      const inspected = this.store.inspect(raw, '').descriptor;
      if ((inspected.recordCollections ?? 0) > 1) {
        return { result, virtualized: false };
      }
      const candidate = virtualResult(sourceTool, inspected, result);
      if (JSON.stringify(candidate).length >= JSON.stringify(result).length) {
        return { result, virtualized: false };
      }

      let descriptor: VirtualContextDescriptor;
      try {
        descriptor = this.store.putMany([raw], new Set([inspected.id]))[0]!;
      } catch {
        return { result, virtualized: false };
      }
      if (!this.store.has(descriptor.id)) return { result, virtualized: false };
      this.descriptors.set(descriptor.id, { descriptor, sourceTool });
      return {
        result: candidate,
        virtualized: true,
        descriptor,
      };
    } catch {
      return { result, virtualized: false };
    }
  }

  callTool(name: string, args: Record<string, unknown>): McpCallToolResult {
    if (name !== MCP_QUERY_TOOL_NAME) return errorResult(`unknown Pinpoint tool: ${name}`);
    try {
      const query = parseQuery(args);
      const text = this.store.query(query);
      const parsed = JSON.parse(text) as unknown;
      const failed = isRecord(parsed) && typeof parsed.error === 'string';
      return {
        content: [{ type: 'text', text }],
        ...(failed ? { isError: true } : {}),
        ...(isRecord(parsed) ? { structuredContent: parsed } : {}),
      };
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : String(error));
    }
  }

  listResources(): readonly Record<string, unknown>[] {
    return [...this.descriptors.values()]
      .filter(({ descriptor }) => this.store.has(descriptor.id))
      .map(({ descriptor, sourceTool }) => ({
        uri: artifactUri(descriptor.id),
        name: `${sourceTool} result`,
        description: `Exact ${descriptor.kind} result retained by Pinpoint; query with ${MCP_QUERY_TOOL_NAME}.`,
        mimeType: artifactMimeType(descriptor),
        size: descriptor.bytes,
      }));
  }

  readResource(uri: string): Record<string, unknown> | undefined {
    if (!uri.startsWith(MCP_ARTIFACT_URI_PREFIX)) return undefined;
    const id = uri.slice(MCP_ARTIFACT_URI_PREFIX.length);
    const artifact = this.descriptors.get(id);
    if (!artifact || !this.store.has(id)) return undefined;
    const preview = this.store.query({ id, op: 'slice', offset: 0, limit: 20 });
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            artifact: artifact.descriptor,
            sourceTool: artifact.sourceTool,
            preview: JSON.parse(preview) as unknown,
            queryTool: MCP_QUERY_TOOL_NAME,
            note: 'This is a bounded preview. Query the artifact instead of loading it in full.',
          }),
        },
      ],
    };
  }
}

interface JsonRpcMessage {
  readonly jsonrpc: '2.0';
  readonly id?: number | string | null;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: unknown;
}

interface PendingRequest {
  readonly method: string;
  readonly toolName?: string;
  readonly firstPage?: boolean;
}

function rpcKey(id: JsonRpcMessage['id']): string {
  return `${typeof id}:${String(id)}`;
}

function parseRpc(line: string): JsonRpcMessage | undefined {
  try {
    const value = JSON.parse(line) as unknown;
    if (!isRecord(value) || value.jsonrpc !== '2.0') return undefined;
    return value as unknown as JsonRpcMessage;
  } catch {
    return undefined;
  }
}

function writeRpc(output: Writable, message: JsonRpcMessage): void {
  output.write(`${JSON.stringify(message)}\n`);
}

function rpcResult(id: JsonRpcMessage['id'], result: unknown): JsonRpcMessage {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id: JsonRpcMessage['id'], code: number, message: string): JsonRpcMessage {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function firstPage(params: unknown): boolean {
  return !isRecord(params) || params.cursor == null;
}

function callParams(params: unknown): { name: string; arguments: Record<string, unknown> } | undefined {
  if (!isRecord(params) || typeof params.name !== 'string') return undefined;
  return {
    name: params.name,
    arguments: isRecord(params.arguments) ? params.arguments : {},
  };
}

function localResources(firewall: McpResultFirewall): Record<string, unknown> {
  return { resources: firewall.listResources() };
}

function localResourceTemplates(): Record<string, unknown> {
  return {
    resourceTemplates: [
      {
        uriTemplate: `${MCP_ARTIFACT_URI_PREFIX}{id}`,
        name: 'Pinpoint exact MCP artifact',
        description: `A losslessly retained upstream result. Use ${MCP_QUERY_TOOL_NAME} for bounded exact access.`,
        mimeType: 'application/json',
      },
    ],
  };
}

function mergeInitialize(result: unknown): unknown {
  if (!isRecord(result)) return result;
  const capabilities = isRecord(result.capabilities) ? result.capabilities : {};
  const resources = isRecord(capabilities.resources) ? capabilities.resources : {};
  const serverInfo = isRecord(result.serverInfo) ? result.serverInfo : {};
  return {
    ...result,
    capabilities: { ...capabilities, tools: isRecord(capabilities.tools) ? capabilities.tools : {}, resources },
    serverInfo: {
      ...serverInfo,
      name: `pinpoint-gateway/${typeof serverInfo.name === 'string' ? serverInfo.name : 'upstream'}`,
    },
  };
}

function mergeTools(result: unknown, firewall: McpResultFirewall, includeLocal: boolean): unknown {
  if (!isRecord(result) || !Array.isArray(result.tools) || !includeLocal) return result;
  const tools = result.tools.filter(isRecord);
  if (tools.some(({ name }) => name === MCP_QUERY_TOOL_NAME)) {
    throw new Error(`upstream MCP server uses reserved tool name ${MCP_QUERY_TOOL_NAME}`);
  }
  const wrapped = tools.map((tool) =>
    isRecord(tool.outputSchema)
      ? {
          ...tool,
          outputSchema: {
            type: 'object',
            oneOf: [tool.outputSchema, MCP_ARTIFACT_OUTPUT_SCHEMA],
          },
        }
      : tool,
  );
  return { ...result, tools: [...wrapped, ...firewall.tools] };
}

function mergeResources(result: unknown, firewall: McpResultFirewall, includeLocal: boolean): unknown {
  if (!isRecord(result) || !Array.isArray(result.resources) || !includeLocal) return result;
  return { ...result, resources: [...result.resources, ...firewall.listResources()] };
}

function mergeResourceTemplates(result: unknown, includeLocal: boolean): unknown {
  if (!isRecord(result) || !Array.isArray(result.resourceTemplates) || !includeLocal) return result;
  const local = localResourceTemplates().resourceTemplates as unknown[];
  return { ...result, resourceTemplates: [...result.resourceTemplates, ...local] };
}

function asToolResult(result: unknown): McpCallToolResult | undefined {
  if (!isRecord(result) || !Array.isArray(result.content)) return undefined;
  return result as unknown as McpCallToolResult;
}

function queueLine(
  current: Promise<void>,
  work: () => Promise<void> | void,
  onError: (error: unknown) => void,
): Promise<void> {
  return current.then(work).catch(onError);
}

/**
 * Transparently proxy one stdio MCP server while virtualizing oversized text
 * results before they enter the host agent's conversation history.
 */
export async function runMcpGateway(
  command: string,
  args: readonly string[] = [],
  options: McpGatewayOptions = {},
): Promise<number | null> {
  if (!command.trim()) throw new TypeError('upstream MCP command is required');

  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const error = options.error ?? process.stderr;
  const firewall = new McpResultFirewall(options);
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  });
  const pending = new Map<string, PendingRequest>();
  let upstreamHasResources = false;
  let clientQueue = Promise.resolve();
  let upstreamQueue = Promise.resolve();

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => error.write(chunk));
  child.stdin.on('error', (cause) => {
    error.write(`[pinpoint mcp gateway] upstream stdin: ${cause.message}\n`);
  });

  const failGateway = (id: JsonRpcMessage['id'], cause: unknown): void => {
    writeRpc(output, rpcError(id, -32603, cause instanceof Error ? cause.message : String(cause)));
  };

  const handleClient = async (line: string): Promise<void> => {
    const message = parseRpc(line.trim());
    if (!message) {
      writeRpc(output, rpcError(null, -32700, 'invalid JSON-RPC message'));
      return;
    }

    if (message.method === 'tools/call' && message.id !== undefined) {
      const call = callParams(message.params);
      if (call?.name === MCP_QUERY_TOOL_NAME) {
        writeRpc(output, rpcResult(message.id, firewall.callTool(call.name, call.arguments)));
        return;
      }
    }

    if (message.method === 'resources/read' && message.id !== undefined) {
      const uri = isRecord(message.params) && typeof message.params.uri === 'string' ? message.params.uri : '';
      if (uri.startsWith(MCP_ARTIFACT_URI_PREFIX)) {
        const result = firewall.readResource(uri);
        writeRpc(
          output,
          result ? rpcResult(message.id, result) : rpcError(message.id, -32002, 'Pinpoint artifact not found'),
        );
        return;
      }
      if (!upstreamHasResources) {
        writeRpc(output, rpcError(message.id, -32002, 'upstream resource not found'));
        return;
      }
    }

    if (message.method === 'resources/list' && message.id !== undefined && !upstreamHasResources) {
      writeRpc(output, rpcResult(message.id, localResources(firewall)));
      return;
    }
    if (
      message.method === 'resources/templates/list' &&
      message.id !== undefined &&
      !upstreamHasResources
    ) {
      writeRpc(output, rpcResult(message.id, localResourceTemplates()));
      return;
    }

    if (message.id !== undefined && message.method) {
      const call = message.method === 'tools/call' ? callParams(message.params) : undefined;
      pending.set(rpcKey(message.id), {
        method: message.method,
        ...(call ? { toolName: call.name } : {}),
        ...(['tools/list', 'resources/list', 'resources/templates/list'].includes(message.method)
          ? { firstPage: firstPage(message.params) }
          : {}),
      });
    }
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  const handleUpstream = async (line: string): Promise<void> => {
    const message = parseRpc(line.trim());
    if (!message) {
      error.write(`[pinpoint mcp gateway] ignored non-JSON upstream stdout: ${line.slice(0, 200)}\n`);
      return;
    }
    if (message.id === undefined || message.method) {
      writeRpc(output, message);
      return;
    }

    const request = pending.get(rpcKey(message.id));
    if (!request) {
      writeRpc(output, message);
      return;
    }
    pending.delete(rpcKey(message.id));
    if (message.error != null) {
      writeRpc(output, message);
      return;
    }

    try {
      let result = message.result;
      if (request.method === 'initialize') {
        if (isRecord(result) && isRecord(result.capabilities)) {
          upstreamHasResources = isRecord(result.capabilities.resources);
        }
        result = mergeInitialize(result);
      } else if (request.method === 'tools/list') {
        result = mergeTools(result, firewall, request.firstPage === true);
      } else if (request.method === 'resources/list') {
        result = mergeResources(result, firewall, request.firstPage === true);
      } else if (request.method === 'resources/templates/list') {
        result = mergeResourceTemplates(result, request.firstPage === true);
      } else if (request.method === 'tools/call' && request.toolName) {
        const toolResult = asToolResult(result);
        if (toolResult) result = firewall.transformResult(request.toolName, toolResult).result;
      }
      writeRpc(output, rpcResult(message.id, result));
    } catch (cause) {
      failGateway(message.id, cause);
    }
  };

  const clientLines = createInterface({ input, crlfDelay: Infinity });
  const upstreamLines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  clientLines.on('line', (line) => {
    clientQueue = queueLine(clientQueue, () => handleClient(line), (cause) => failGateway(null, cause));
  });
  upstreamLines.on('line', (line) => {
    upstreamQueue = queueLine(
      upstreamQueue,
      () => handleUpstream(line),
      (cause) => error.write(`[pinpoint mcp gateway] ${cause instanceof Error ? cause.message : String(cause)}\n`),
    );
  });
  clientLines.once('close', () => child.stdin.end());

  const abort = (): void => {
    child.kill('SIGTERM');
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  options.signal?.removeEventListener('abort', abort);
  clientLines.close();
  upstreamLines.close();
  await Promise.all([clientQueue, upstreamQueue]);
  return exitCode;
}