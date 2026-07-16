import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { arch, platform, release, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { MCP_QUERY_TOOL_NAME, runMcpGateway } from '../../dist/mcp/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const resultPath = join(
  root,
  'benchmarks',
  'results',
  'mcp-oss-filesystem.first-party-macos-arm64-20260715.json',
);
const packageName = '@modelcontextprotocol/server-filesystem';
const packageVersion = '2026.7.10';
const temporary = mkdtempSync(join(tmpdir(), 'pinpoint-oss-filesystem-'));
const fixturePath = join(temporary, 'accounts.json');
const expected = 'oss-user-733@example.invalid';
const rows = Array.from({ length: 1_000 }, (_, accountId) => ({
  accountId,
  email: `oss-user-${accountId}@example.invalid`,
  active: accountId % 2 === 0,
  region: ['us-east', 'eu-west', 'ap-south'][accountId % 3],
}));
writeFileSync(fixturePath, JSON.stringify(rows));

function fingerprint(path) {
  return createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
}

function responses(stream, visible) {
  let buffer = '';
  const pending = [];
  const queued = [];
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    visible.push(chunk);
    buffer += chunk;
    while (buffer.includes('\n')) {
      const newline = buffer.indexOf('\n');
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const value = JSON.parse(line);
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

const input = new PassThrough();
const output = new PassThrough();
const error = new PassThrough();
const visible = [];
const diagnostics = [];
error.on('data', (chunk) => diagnostics.push(String(chunk)));
const next = responses(output, visible);
const running = runMcpGateway(
  'npx',
  ['-y', `${packageName}@${packageVersion}`, temporary],
  { input, output, error, minChars: 1_000 },
);

let requestId = 0;
async function request(method, params = {}) {
  const id = ++requestId;
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  const response = await next();
  if (response.id !== id) throw new Error(`response id mismatch: expected ${id}, received ${response.id}`);
  return response;
}

try {
  const initialized = await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'pinpoint-oss-gate', version: '1.0.0' },
  });
  input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const listed = await request('tools/list');
  const toolNames = listed.result.tools.map(({ name }) => name);
  const source = await request('tools/call', {
    name: 'read_text_file',
    arguments: { path: fixturePath },
  });
  const sourceText = JSON.stringify(source);
  const artifactIds = [...new Set(sourceText.match(/vctx_[a-f0-9]{32,64}/g) ?? [])];
  const artifactId = artifactIds[0];
  const queried = await request('tools/call', {
    name: MCP_QUERY_TOOL_NAME,
    arguments: {
      id: artifactId,
      op: 'json_select',
      where: { accountId: 733 },
      fields: ['email'],
    },
  });
  const queryText = queried.result?.content?.[0]?.text ?? '{}';
  const queryResult = JSON.parse(queryText);
  input.end();
  const gatewayExitCode = await running;
  const clientTranscript = visible.join('');
  const unrelatedCanaries = rows
    .filter(({ accountId }) => accountId !== 733)
    .map(({ email }) => email);
  const leakedUnrelatedRows = unrelatedCanaries.filter((email) => clientTranscript.includes(email));
  const rawSourceBytes = Buffer.byteLength(JSON.stringify(rows));
  const sourceVisibleBytes = Buffer.byteLength(sourceText);
  const passed =
    gatewayExitCode === 0 &&
    initialized.result?.serverInfo?.name?.startsWith('pinpoint-gateway/') &&
    toolNames.includes('read_text_file') &&
    toolNames.includes(MCP_QUERY_TOOL_NAME) &&
    artifactIds.length === 1 &&
    !sourceText.includes(expected) &&
    queryResult.count === 1 &&
    queryResult.truncated === false &&
    queryResult.matches?.[0]?.email === expected &&
    leakedUnrelatedRows.length === 0;
  const result = {
    schemaVersion: 1,
    evidenceLevel: 'oss-protocol-integration',
    kind: 'mcp-result-firewall-oss-filesystem-gate',
    date: new Date().toISOString().slice(0, 10),
    passed,
    environment: {
      platform: platform(),
      release: release(),
      architecture: arch(),
      node: process.version,
    },
    upstream: {
      package: packageName,
      version: packageVersion,
      modification: 'none',
      transport: 'stdio',
      sourceTool: 'read_text_file',
    },
    fixture: {
      records: rows.length,
      rawSourceBytes,
      selectedAccountId: 733,
    },
    summary: {
      gatewayExitCode,
      upstreamToolPresent: toolNames.includes('read_text_file'),
      queryToolPresent: toolNames.includes(MCP_QUERY_TOOL_NAME),
      artifactCapabilities: artifactIds.length,
      sourceVisibleBytes,
      selectedRows: queryResult.count ?? null,
      exactAnswer: queryResult.matches?.[0]?.email === expected,
      unrelatedCanariesScanned: unrelatedCanaries.length,
      unrelatedCanariesLeaked: leakedUnrelatedRows.length,
    },
    source: {
      fingerprints: {
        'src/mcp/gateway.ts': fingerprint('src/mcp/gateway.ts'),
        'src/virtual-context/store.ts': fingerprint('src/virtual-context/store.ts'),
        'benchmarks/v2/mcp_oss_filesystem_gate.mjs': fingerprint('benchmarks/v2/mcp_oss_filesystem_gate.mjs'),
      },
    },
    limitations: [
      'This validates the result-firewall/query mode against one published OSS MCP server, not value-opaque destination composition.',
      'The fixture is synthetic and generated by Pinpoint maintainers.',
      'The npx package is fetched from the public npm registry at the pinned version.',
      'One OSS server does not establish compatibility with the broader MCP ecosystem.',
    ],
  };
  if (process.argv.includes('--write')) writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (!passed) {
    const diagnostic = diagnostics.join('').slice(-2_000);
    if (diagnostic) console.error(diagnostic);
    process.exitCode = 1;
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}