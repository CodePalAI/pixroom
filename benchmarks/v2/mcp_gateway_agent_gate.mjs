import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cli = join(root, 'bin', 'cli.js');
const expected = 'user733@example.com';
const debugDirectory = mkdtempSync(join(tmpdir(), 'pinpoint-mcp-gate-'));
const debugFile = join(debugDirectory, 'claude-debug.log');

const upstream = String.raw`
  import { createInterface } from 'node:readline';
  const rows = Array.from({ length: 1000 }, (_, accountId) => ({
    accountId,
    email: 'user' + accountId + '@example.com',
    active: accountId % 2 === 0,
    region: ['us-east', 'eu-west', 'ap-south'][accountId % 3],
  }));
  const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    const message = JSON.parse(line);
    if (message.method === 'initialize') {
      send(message.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'accounts', version: '1.0.0' },
      });
    } else if (message.method === 'tools/list') {
      send(message.id, {
        tools: [{
          name: 'accounts_list',
          description: 'Return every account. This upstream API has no filtering parameter.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          outputSchema: {
            type: 'object',
            properties: {
              requestId: { type: 'string' },
              data: { type: 'object' },
            },
            required: ['requestId', 'data'],
          },
        }],
      });
    } else if (message.method === 'tools/call') {
      send(message.id, {
        content: [{ type: 'text', text: 'Returned 1000 accounts in structured content.' }],
        structuredContent: { requestId: 'synthetic_gate', data: { accounts: rows } },
      });
    }
  }
`;

const config = JSON.stringify({
  mcpServers: {
    accounts: {
      type: 'stdio',
      command: process.execPath,
      args: [
        cli,
        'mcp',
        'gateway',
        '--min-chars',
        '1000',
        '--',
        process.execPath,
        '--input-type=module',
        '--eval',
        upstream,
      ],
    },
  },
});

function runClaude() {
  const args = [
    '--print',
    'Use the accounts MCP server to find the email for accountId 733. Return only the email address. Do not use repository files or shell commands.',
    '--model',
    'claude-haiku-4-5-20251001',
    '--max-budget-usd',
    '0.15',
    '--debug',
    'mcp',
    '--debug-file',
    debugFile,
    '--verbose',
    '--output-format',
    'stream-json',
    '--no-session-persistence',
    '--permission-mode',
    'plan',
    '--strict-mcp-config',
    '--mcp-config',
    config,
    '--allowedTools',
    'mcp__accounts__accounts_list,mcp__accounts__pinpoint_query',
    '--disallowedTools',
    'Bash,Read,Grep,Glob,Agent,Edit,Write',
  ];

  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, {
      cwd: root,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let exceeded = false;
    const timeout = setTimeout(() => child.kill('SIGTERM'), 120_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 5_000_000) {
        exceeded = true;
        child.kill('SIGTERM');
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 1_000_000) stderr = stderr.slice(-1_000_000);
    });
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr, exceeded });
    });
  });
}

const run = await runClaude();
const events = run.stdout
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const calls = events.flatMap((event) =>
  event.type === 'assistant' && Array.isArray(event.message?.content)
    ? event.message.content
        .filter((block) => block.type === 'tool_use')
        .map((block) => ({ name: block.name, input: block.input }))
    : [],
);
const resultSizes = events.flatMap((event) =>
  event.type === 'user' && Array.isArray(event.message?.content)
    ? event.message.content
        .filter((block) => block.type === 'tool_result')
        .map((block) => JSON.stringify(block.content ?? '').length)
    : [],
);
const finalEvent = [...events].reverse().find((event) => event.type === 'result');
const answer = typeof finalEvent?.result === 'string' ? finalEvent.result.trim() : '';
const upstreamCalled = calls.some(({ name }) => name.endsWith('__accounts_list'));
const queryCalled = calls.some(({ name }) => name.endsWith('__pinpoint_query'));
const maxToolResultChars = Math.max(0, ...resultSizes);
const passed =
  run.code === 0 &&
  !run.exceeded &&
  upstreamCalled &&
  queryCalled &&
  maxToolResultChars < 5_000 &&
  answer === expected;

console.log(JSON.stringify({
  passed,
  agentExitCode: run.code,
  upstreamCalled,
  queryCalled,
  toolCalls: calls,
  maxToolResultChars,
  answer,
  expected,
  totalCostUSD: finalEvent?.total_cost_usd ?? null,
  turns: finalEvent?.num_turns ?? null,
}, null, 2));

if (!passed) {
  const diagnostic = run.stderr.trim().slice(-2_000);
  if (diagnostic) console.error(diagnostic.replace(/(?:sk-ant-|sk-)[A-Za-z0-9_-]+/g, '[REDACTED]'));
  try {
    const debug = readFileSync(debugFile, 'utf8')
      .split('\n')
      .filter((line) => /mcp|accounts|error|fail|spawn|stdio/i.test(line))
      .map((line) => line.replace(/(?:sk-ant-|sk-)[A-Za-z0-9_-]+/g, '[REDACTED]').slice(0, 800))
      .slice(-80)
      .join('\n');
    if (debug) console.error(debug);
  } catch {
    // A missing debug log is itself non-fatal diagnostic information.
  }
  process.exitCode = 1;
}

rmSync(debugDirectory, { recursive: true, force: true });