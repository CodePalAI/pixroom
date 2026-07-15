import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import {
  MCP_QUERY_TOOL_NAME,
  McpResultFirewall,
  runMcpGateway,
} from '../src/mcp/gateway.js';

function send(stream: PassThrough, message: unknown): void {
  stream.write(`${JSON.stringify(message)}\n`);
}

function responses(stream: PassThrough): () => Promise<Record<string, unknown>> {
  let buffer = '';
  const pending: Array<(value: Record<string, unknown>) => void> = [];
  const queued: Record<string, unknown>[] = [];
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const newline = buffer.indexOf('\n');
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const value = JSON.parse(line) as Record<string, unknown>;
      const resolve = pending.shift();
      if (resolve) resolve(value);
      else queued.push(value);
    }
  });
  return () => {
    const value = queued.shift();
    if (value) return Promise.resolve(value);
    return new Promise((resolve) => pending.push(resolve));
  };
}

describe('McpResultFirewall', () => {
  it('virtualizes an oversized upstream result and recovers an exact row', () => {
    const firewall = new McpResultFirewall({ minChars: 500 });
    const rows = Array.from({ length: 200 }, (_, accountId) => ({
      accountId,
      email: `user${accountId}@example.com`,
      active: accountId % 2 === 0,
    }));
    const raw = JSON.stringify(rows);

    const transformed = firewall.transformResult('accounts_list', {
      content: [{ type: 'text', text: raw }],
    });

    expect(transformed.virtualized).toBe(true);
    expect(transformed.descriptor).toMatchObject({
      kind: 'json-array',
      items: 200,
      fields: ['accountId', 'active', 'email'],
    });
    expect(JSON.stringify(transformed.result).length).toBeLessThan(raw.length / 5);
    expect(transformed.result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'resource_link',
          uri: `pinpoint://artifact/${transformed.descriptor?.id}`,
        }),
      ]),
    );

    const queried = firewall.callTool(MCP_QUERY_TOOL_NAME, {
      id: transformed.descriptor?.id,
      op: 'json_select',
      where: { accountId: 73 },
      fields: ['email'],
    });

    expect(queried.isError).not.toBe(true);
    expect(JSON.parse(queried.content[0]?.text ?? '{}')).toEqual({
      matches: [{ email: 'user73@example.com' }],
      count: 1,
      truncated: false,
    });
  });

  it('leaves small and error results byte-for-byte equivalent', () => {
    const firewall = new McpResultFirewall({ minChars: 500 });
    const small = { content: [{ type: 'text', text: '{"ok":true}' }] };
    const error = {
      content: [{ type: 'text', text: 'ERROR '.repeat(200) }],
      isError: true,
    };

    expect(firewall.transformResult('small', small)).toEqual({
      result: small,
      virtualized: false,
    });
    expect(firewall.transformResult('error', error)).toEqual({
      result: error,
      virtualized: false,
    });
  });

  it('finds the only nested record array in structured MCP output', () => {
    const firewall = new McpResultFirewall({ minChars: 500 });
    const rows = Array.from({ length: 100 }, (_, accountId) => ({
      accountId,
      email: `nested${accountId}@example.com`,
    }));
    const transformed = firewall.transformResult('accounts_search', {
      content: [{ type: 'text', text: '100 matching accounts' }],
      structuredContent: {
        requestId: 'req_123',
        data: { accounts: rows },
      },
    });

    expect(transformed.virtualized).toBe(true);
    expect(transformed.descriptor).toMatchObject({
      kind: 'json-array',
      items: 100,
      fields: ['accountId', 'email'],
      dataPath: ['data', 'accounts'],
    });
    const queried = firewall.callTool(MCP_QUERY_TOOL_NAME, {
      id: transformed.descriptor?.id,
      op: 'json_select',
      where: { accountId: 73 },
      fields: ['email'],
    });
    expect(JSON.parse(queried.content[0]?.text ?? '{}')).toMatchObject({
      matches: [{ email: 'nested73@example.com' }],
      count: 1,
    });
  });

  it('fails open when the exact artifact cannot fit in local storage', () => {
    const firewall = new McpResultFirewall({ minChars: 10, maxStoredBytes: 64 });
    const original = {
      content: [{ type: 'text', text: JSON.stringify([{ id: 1, value: 'x'.repeat(500) }]) }],
    };

    expect(firewall.transformResult('oversized', original)).toEqual({
      result: original,
      virtualized: false,
    });
    expect(firewall.store.size).toBe(0);
  });

  it('fails open on structured values that cannot be serialized', () => {
    const firewall = new McpResultFirewall({ minChars: 1 });
    const original = {
      content: [{ type: 'text', text: 'structured result' }],
      structuredContent: { unsupported: 1n },
    };

    expect(firewall.transformResult('unsupported', original)).toEqual({
      result: original,
      virtualized: false,
    });
  });

  it('fails open on competing nested record collections', () => {
    const firewall = new McpResultFirewall({ minChars: 100 });
    const records = Array.from({ length: 20 }, (_, id) => ({ id, value: 'x'.repeat(20) }));
    const original = {
      content: [{ type: 'text', text: 'two collections' }],
      structuredContent: { data: { accounts: records, orders: records } },
    };

    expect(firewall.transformResult('ambiguous', original)).toEqual({
      result: original,
      virtualized: false,
    });
    expect(firewall.store.size).toBe(0);
  });

  it('proxies an upstream MCP server before the host can truncate its result', async () => {
    const upstream = String.raw`
      import { createInterface } from 'node:readline';
      const rows = Array.from({ length: 200 }, (_, accountId) => ({
        accountId,
        email: 'user' + accountId + '@example.com',
        active: accountId % 2 === 0,
      }));
      const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
      const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
      for await (const line of lines) {
        const message = JSON.parse(line);
        if (message.method === 'initialize') {
          reply(message.id, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'accounts', version: '1.0.0' },
          });
        } else if (message.method === 'tools/list') {
          reply(message.id, {
            tools: [{
              name: 'accounts_list',
              description: 'List accounts.',
              inputSchema: { type: 'object', properties: {} },
              outputSchema: {
                type: 'object',
                properties: { rows: { type: 'array' } },
                required: ['rows'],
              },
            }],
          });
        } else if (message.method === 'tools/call') {
          reply(message.id, {
            content: [{ type: 'text', text: JSON.stringify(rows) }],
          });
        }
      }
    `;
    const input = new PassThrough();
    const output = new PassThrough();
    const error = new PassThrough();
    const next = responses(output);
    const running = runMcpGateway(process.execPath, ['--input-type=module', '--eval', upstream], {
      input,
      output,
      error,
      minChars: 500,
    });

    send(input, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const initialized = await next();
    expect(initialized).toMatchObject({
      id: 1,
      result: { capabilities: { tools: {}, resources: {} } },
    });

    send(input, { jsonrpc: '2.0', method: 'notifications/initialized' });
    send(input, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const listed = await next();
    const tools = (listed.result as { tools: Array<{ name: string; outputSchema?: unknown }> }).tools;
    expect(tools.map(({ name }) => name)).toEqual([
      'accounts_list',
      MCP_QUERY_TOOL_NAME,
    ]);
    expect(tools[0]?.outputSchema).toMatchObject({ oneOf: expect.any(Array) });

    send(input, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'accounts_list', arguments: {} },
    });
    const called = await next();
    const callResult = called.result as { content: Array<Record<string, unknown>> };
    const resource = callResult.content.find(({ type }) => type === 'resource_link');
    expect(resource?.uri).toMatch(/^pinpoint:\/\/artifact\/vctx_[a-f0-9]{32}$/);
    const artifactId = String(resource?.uri).split('/').at(-1);

    send(input, {
      jsonrpc: '2.0',
      id: 31,
      method: 'resources/read',
      params: { uri: resource?.uri },
    });
    const read = await next();
    const resourceText = (read.result as { contents: Array<{ text: string }> }).contents[0]?.text ?? '';
    expect(resourceText.length).toBeLessThan(12_000);
    expect(resourceText).toContain('bounded preview');

    send(input, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: MCP_QUERY_TOOL_NAME,
        arguments: {
          id: artifactId,
          op: 'json_select',
          where: { accountId: 73 },
          fields: ['email'],
        },
      },
    });
    const queried = await next();
    const queryResult = queried.result as { content: Array<{ text: string }> };
    expect(JSON.parse(queryResult.content[0]?.text ?? '{}')).toEqual({
      matches: [{ email: 'user73@example.com' }],
      count: 1,
      truncated: false,
    });

    input.end();
    expect(await running).toBe(0);
  });

  it('terminates the wrapped server when the gateway is aborted', async () => {
    const upstream = String.raw`
      import { createInterface } from 'node:readline';
      const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
      for await (const line of lines) {
        const message = JSON.parse(line);
        if (message.method === 'initialize') {
          process.stdout.write(JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'abort-test', version: '1.0.0' },
            },
          }) + '\n');
        }
      }
    `;
    const input = new PassThrough();
    const output = new PassThrough();
    const controller = new AbortController();
    const next = responses(output);
    const running = runMcpGateway(process.execPath, ['--input-type=module', '--eval', upstream], {
      input,
      output,
      error: new PassThrough(),
      signal: controller.signal,
    });

    send(input, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    await next();
    controller.abort();

    expect(await running).toBeNull();
  });
});