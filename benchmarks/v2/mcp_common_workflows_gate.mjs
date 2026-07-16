import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  'mcp-common-workflows.first-party-macos-arm64-20260716.json',
);
const filesystemPackage = '@modelcontextprotocol/server-filesystem@2026.7.10';
const memoryPackage = '@modelcontextprotocol/server-memory@2026.7.4';
const gitPackage = 'mcp-server-git==2026.7.10';
const temporary = mkdtempSync(join(tmpdir(), 'pinpoint-common-workflows-'));
let temporaryRemoved = false;
function removeTemporary() {
  if (temporaryRemoved) return;
  temporaryRemoved = true;
  rmSync(temporary, { recursive: true, force: true });
}
process.once('exit', removeTemporary);

function commandVersion(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8' }).trim();
  } catch {
    throw new Error(`${command} is required to run the common MCP workflow benchmark`);
  }
}

const tools = {
  git: commandVersion('git', ['--version']),
  npx: commandVersion('npx', ['--version']),
  uvx: commandVersion('uvx', ['--version']),
};
const fixturePath = join(temporary, 'accounts.json');
const logFixturePath = join(temporary, 'service.log');
const home = join(temporary, 'home');
const cache = join(temporary, 'npm-cache');
const uvCache = join(temporary, 'uv-cache');
mkdirSync(home);
mkdirSync(cache);
mkdirSync(uvCache);

const rows = Array.from({ length: 1_000 }, (_, accountId) => ({
  accountId,
  email: `workflow-user-${accountId}@example.invalid`,
  active: accountId % 2 === 0,
  region: ['us-east', 'eu-west', 'ap-south'][accountId % 3],
}));
const selectedAccountId = 733;
const expected = rows[selectedAccountId].email;
const unrelatedCanaries = rows
  .filter(({ accountId }) => accountId !== selectedAccountId)
  .map(({ email }) => email);
writeFileSync(fixturePath, JSON.stringify(rows));

const incidentId = 'INCIDENT-0427';
const logLines = Array.from({ length: 2_000 }, (_, index) => {
  const marker = `log-private-${String(index).padStart(4, '0')}`;
  return index === 1_427
    ? `2026-07-16T12:23:47Z ERROR incident=${incidentId} marker=${marker} payment authorization timed out`
    : `2026-07-16T12:${String(index % 60).padStart(2, '0')}:00Z INFO marker=${marker} request completed`;
});
const expectedLogLine = logLines[1_427];
const logCanaries = logLines
  .filter((_, index) => index !== 1_427)
  .map((line) => /marker=(\S+)/.exec(line)?.[1])
  .filter(Boolean);
writeFileSync(logFixturePath, logLines.join('\n'));

const memoryEntities = Array.from({ length: 500 }, (_, index) => ({
  name: `customer-${String(index).padStart(4, '0')}`,
  entityType: 'synthetic_customer',
  observations: [`memory-private-${String(index).padStart(4, '0')}`],
}));
const selectedEntityName = 'customer-0311';
const expectedObservation = 'memory-private-0311';
const memoryCanaries = memoryEntities
  .filter(({ name }) => name !== selectedEntityName)
  .flatMap(({ name, observations }) => [name, ...observations]);

const gitRepository = join(temporary, 'git-repository');
const gitMarker = 'BUGFIX-0427';
const gitLines = Array.from({ length: 2_000 }, (_, index) => {
  const marker = `git-private-${String(index).padStart(4, '0')}`;
  return index === 1_427
    ? `export const record1427 = '${gitMarker} payment retry guard';`
    : `export const record${String(index).padStart(4, '0')} = '${marker}';`;
});
const expectedGitLine = `+${gitLines[1_427]}`;
const gitCanaries = gitLines
  .filter((_, index) => index !== 1_427)
  .map((line) => /'(git-private-\d+)'/.exec(line)?.[1])
  .filter(Boolean);
const gitEnvironment = {
  PATH: process.env.PATH,
  HOME: home,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
  LC_ALL: 'C',
};
mkdirSync(gitRepository);
writeFileSync(join(gitRepository, 'records.ts'), `${gitLines.join('\n')}\n`);
execFileSync('git', ['init', '--initial-branch', 'main'], {
  cwd: gitRepository,
  env: gitEnvironment,
  stdio: 'ignore',
});
execFileSync('git', ['add', 'records.ts'], {
  cwd: gitRepository,
  env: gitEnvironment,
  stdio: 'ignore',
});
execFileSync(
  'git',
  ['-c', 'user.name=Pinpoint Benchmark', '-c', 'user.email=benchmark@example.invalid', 'commit', '-m', 'Add generated records'],
  {
    cwd: gitRepository,
    env: {
      ...gitEnvironment,
      GIT_AUTHOR_DATE: '2026-07-16T12:00:00Z',
      GIT_COMMITTER_DATE: '2026-07-16T12:00:00Z',
    },
    stdio: 'ignore',
  },
);

const serverEnvironment = {
  PATH: process.env.PATH,
  HOME: home,
  npm_config_cache: cache,
  npm_config_userconfig: '/dev/null',
  npm_config_yes: 'true',
  UV_CACHE_DIR: uvCache,
  UV_NO_CONFIG: '1',
};

function responseReader(stream) {
  let buffer = '';
  const pending = [];
  const queued = [];
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const newline = buffer.indexOf('\n');
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const response = JSON.parse(line);
      const resolve = pending.shift();
      if (resolve) resolve(response);
      else queued.push(response);
    }
  });
  return () => {
    const response = queued.shift();
    if (response) return Promise.resolve(response);
    return new Promise((resolve) => pending.push(resolve));
  };
}

function rpcClient(input, output) {
  const next = responseReader(output);
  let requestId = 0;
  return {
    notify(method, params = {}) {
      input.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    },
    async request(method, params = {}) {
      const id = ++requestId;
      input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      while (true) {
        const response = await next();
        if (response.id == null) continue;
        if (response.id !== id) {
          throw new Error(`response id mismatch: expected ${id}, received ${response.id}`);
        }
        if (response.error) throw new Error(`MCP ${method} failed: ${JSON.stringify(response.error)}`);
        return response;
      }
    },
  };
}

async function initialize(client, name) {
  await client.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name, version: '1.0.0' },
  });
  client.notify('notifications/initialized');
}

function toolText(response) {
  return response.result?.content?.find(({ type }) => type === 'text')?.text ?? '';
}

function queryPayload(response) {
  return JSON.parse(toolText(response) || '{}');
}

function countVisibleCanaries(text, canaries) {
  return canaries.reduce((count, value) => count + Number(text.includes(value)), 0);
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function fingerprint(path) {
  return createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
}

async function runDirectWorkflow(config) {
  const child = spawn(config.serverCommand ?? 'npx', config.serverArgs, {
    env: config.environment('direct'),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let diagnostics = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { diagnostics += chunk; });
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  const client = rpcClient(child.stdin, child.stdout);
  try {
    await initialize(client, `${config.id}-direct`);
    await config.prepare?.(client);
    const source = await client.request('tools/call', config.sourceCall);
    const visibleText = JSON.stringify(source);
    const answer = config.directAnswer(toolText(source));
    child.stdin.end();
    const exitCode = await exited;
    if (exitCode !== 0 && diagnostics) process.stderr.write(diagnostics.slice(-2_000));
    return {
      exitCode,
      exactAnswer: sameValue(answer, config.expected),
      answer,
      visibleBytes: Buffer.byteLength(visibleText),
      unrelatedCanariesVisible: countVisibleCanaries(visibleText, config.canaries),
    };
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}

async function runPinpointWorkflow(config) {
  const input = new PassThrough();
  const output = new PassThrough();
  const error = new PassThrough();
  let diagnostics = '';
  error.setEncoding('utf8');
  error.on('data', (chunk) => { diagnostics += chunk; });
  const running = runMcpGateway(config.serverCommand ?? 'npx', config.serverArgs, {
    input,
    output,
    error,
    env: config.environment('pinpoint'),
    minChars: 1_000,
  });
  const client = rpcClient(input, output);
  try {
    await initialize(client, `${config.id}-pinpoint`);
    await config.prepare?.(client);
    const source = await client.request('tools/call', config.sourceCall);
    const sourceText = JSON.stringify(source);
    const artifactIds = [...new Set(sourceText.match(/vctx_[a-f0-9]{32,64}/g) ?? [])];
    const queried = artifactIds.length === 1 && config.query
      ? await client.request('tools/call', {
          name: MCP_QUERY_TOOL_NAME,
          arguments: { id: artifactIds[0], ...config.query },
        })
      : undefined;
    const answer = queried
      ? config.queryAnswer(queryPayload(queried))
      : config.directAnswer(toolText(source));
    const queryResponseText = queried ? JSON.stringify(queried) : '';
    const visibleText = queried ? `${sourceText}\n${queryResponseText}` : sourceText;
    input.end();
    const exitCode = await running;
    if (exitCode !== 0 && diagnostics) process.stderr.write(diagnostics.slice(-2_000));
    return {
      exitCode,
      exactAnswer: sameValue(answer, config.expected),
      answer,
      artifactCapabilities: artifactIds.length,
      visibleBytes: Buffer.byteLength(visibleText),
      unrelatedCanariesVisible: countVisibleCanaries(visibleText, config.canaries),
    };
  } finally {
    input.end();
  }
}

async function runPairedWorkflow(config) {
  const direct = await runDirectWorkflow(config);
  const pinpoint = await runPinpointWorkflow(config);
  const visibleByteReduction = 1 - pinpoint.visibleBytes / direct.visibleBytes;
  const sameAnswer = sameValue(direct.answer, pinpoint.answer);
  const expectedArtifactCapabilities = config.mode === 'virtualized' ? 1 : 0;
  const expectedDirectCanaries = config.expectedDirectCanaries ?? config.canaries.length;
  const disclosurePassed = config.mode === 'virtualized'
    ? direct.unrelatedCanariesVisible === expectedDirectCanaries &&
      pinpoint.unrelatedCanariesVisible === 0 &&
      visibleByteReduction >= 0.9
    : direct.unrelatedCanariesVisible === expectedDirectCanaries &&
      pinpoint.unrelatedCanariesVisible === expectedDirectCanaries &&
      Math.abs(visibleByteReduction) <= 0.05;
  const passed =
    direct.exitCode === 0 &&
    pinpoint.exitCode === 0 &&
    direct.exactAnswer &&
    pinpoint.exactAnswer &&
    sameAnswer &&
    pinpoint.artifactCapabilities === expectedArtifactCapabilities &&
    disclosurePassed;
  return {
    id: config.id,
    description: config.description,
    server: config.server,
    mode: config.mode,
    operation: config.query?.op ?? 'native-filter',
    passed,
    direct,
    pinpoint,
    comparison: {
      sameAnswer,
      visibleByteReduction,
      unrelatedCanariesAvoided:
        direct.unrelatedCanariesVisible - pinpoint.unrelatedCanariesVisible,
    },
  };
}

const filesystemEnvironment = () => serverEnvironment;
const filesystemArgs = ['-y', filesystemPackage, temporary];
const memoryEnvironment = (workflowId) => (arm) => ({
  ...serverEnvironment,
  MEMORY_FILE_PATH: join(temporary, `memory-${workflowId}-${arm}.jsonl`),
});
const prepareMemory = async (client) => {
  const created = await client.request('tools/call', {
    name: 'create_entities',
    arguments: { entities: memoryEntities },
  });
  if (created.result?.isError) throw new Error(`memory fixture setup failed: ${toolText(created)}`);
};
const workflowConfigs = [
  {
    id: 'filesystem-exact-record-lookup',
    description: 'Find one account email in a large JSON export.',
    mode: 'virtualized',
    server: filesystemPackage,
    serverArgs: filesystemArgs,
    environment: filesystemEnvironment,
    sourceCall: { name: 'read_text_file', arguments: { path: fixturePath } },
    directAnswer: (text) => JSON.parse(text).find(({ accountId }) => accountId === selectedAccountId)?.email ?? null,
    query: { op: 'json_select', where: { accountId: selectedAccountId }, fields: ['email'] },
    queryAnswer: ({ matches }) => matches?.[0]?.email ?? null,
    expected,
    canaries: unrelatedCanaries,
  },
  {
    id: 'filesystem-filtered-count',
    description: 'Count active EU accounts in a large JSON export.',
    mode: 'virtualized',
    server: filesystemPackage,
    serverArgs: filesystemArgs,
    environment: filesystemEnvironment,
    sourceCall: { name: 'read_text_file', arguments: { path: fixturePath } },
    directAnswer: (text) => JSON.parse(text).filter(({ active, region }) => active && region === 'eu-west').length,
    query: { op: 'count', where: { active: true, region: 'eu-west' } },
    queryAnswer: ({ count }) => count,
    expected: rows.filter(({ active, region }) => active && region === 'eu-west').length,
    canaries: rows.map(({ email }) => email),
  },
  {
    id: 'filesystem-incident-log-triage',
    description: 'Find one incident line in a large service log.',
    mode: 'virtualized',
    server: filesystemPackage,
    serverArgs: filesystemArgs,
    environment: filesystemEnvironment,
    sourceCall: { name: 'read_text_file', arguments: { path: logFixturePath } },
    directAnswer: (text) => text.split(/\r?\n/).find((line) => line.includes(incidentId)) ?? null,
    query: { op: 'grep', query: incidentId, limit: 5 },
    queryAnswer: ({ matches }) => matches?.[0]?.text ?? null,
    expected: expectedLogLine,
    canaries: logCanaries,
  },
  {
    id: 'memory-knowledge-graph-lookup',
    description: 'Retrieve one customer observation from a large knowledge graph.',
    mode: 'virtualized',
    server: memoryPackage,
    serverArgs: ['-y', memoryPackage],
    environment: memoryEnvironment('full-graph'),
    prepare: prepareMemory,
    sourceCall: { name: 'read_graph', arguments: {} },
    directAnswer: (text) => {
      const graph = JSON.parse(text);
      return graph.entities?.find(({ name }) => name === selectedEntityName)?.observations?.[0] ?? null;
    },
    query: { op: 'json_select', where: { name: selectedEntityName }, fields: ['observations'] },
    queryAnswer: ({ matches }) => matches?.[0]?.observations?.[0] ?? null,
    expected: expectedObservation,
    canaries: memoryCanaries,
  },
  {
    id: 'memory-native-node-lookup-control',
    description: 'Retrieve one customer through the MCP server native bounded lookup.',
    mode: 'passthrough',
    server: memoryPackage,
    serverArgs: ['-y', memoryPackage],
    environment: memoryEnvironment('native-lookup'),
    prepare: prepareMemory,
    sourceCall: { name: 'open_nodes', arguments: { names: [selectedEntityName] } },
    directAnswer: (text) => {
      const graph = JSON.parse(text);
      return graph.entities?.find(({ name }) => name === selectedEntityName)?.observations?.[0] ?? null;
    },
    expected: expectedObservation,
    expectedDirectCanaries: 0,
    canaries: memoryCanaries,
  },
  {
    id: 'git-large-commit-triage',
    description: 'Find one change marker in a large commit diff.',
    mode: 'virtualized',
    server: gitPackage,
    serverCommand: 'uvx',
    serverArgs: [gitPackage, '--repository', gitRepository],
    environment: filesystemEnvironment,
    sourceCall: {
      name: 'git_show',
      arguments: { repo_path: gitRepository, revision: 'HEAD' },
    },
    directAnswer: (text) => text.split(/\r?\n/).find((line) => line.includes(gitMarker)) ?? null,
    query: { op: 'grep', query: gitMarker, limit: 5 },
    queryAnswer: ({ matches }) => matches?.[0]?.text ?? null,
    expected: expectedGitLine,
    canaries: gitCanaries,
  },
];

try {
  const workflows = [];
  for (const workflow of workflowConfigs) workflows.push(await runPairedWorkflow(workflow));
  const directVisibleBytes = workflows.reduce((sum, workflow) => sum + workflow.direct.visibleBytes, 0);
  const pinpointVisibleBytes = workflows.reduce((sum, workflow) => sum + workflow.pinpoint.visibleBytes, 0);
  const passed = workflows.every(({ passed: workflowPassed }) => workflowPassed);
  const result = {
    schemaVersion: 1,
    evidenceLevel: 'paired-oss-protocol-integration',
    kind: 'mcp-common-workflows-gate',
    date: new Date().toISOString().slice(0, 10),
    passed,
    environment: {
      platform: platform(),
      release: release(),
      architecture: arch(),
      node: process.version,
      tools,
    },
    summary: {
      workflows: workflows.length,
      workflowsPassed: workflows.filter(({ passed: workflowPassed }) => workflowPassed).length,
      publishedServers: new Set(workflows.map(({ server }) => server)).size,
      operations: [...new Set(workflows.map(({ operation }) => operation))].sort(),
      directVisibleBytes,
      pinpointVisibleBytes,
      aggregateVisibleByteReduction: 1 - pinpointVisibleBytes / directVisibleBytes,
      unrelatedCanariesAvoided: workflows.reduce(
        (sum, workflow) => sum + workflow.comparison.unrelatedCanariesAvoided,
        0,
      ),
    },
    workflows,
    source: {
      fingerprints: Object.fromEntries([
        'src/mcp/gateway.ts',
        'src/virtual-context/store.ts',
        'benchmarks/v2/mcp_common_workflows_gate.mjs',
      ].map((path) => [path, fingerprint(path)])),
    },
    limitations: [
      'These are maintainer-authored synthetic workflows over three pinned published MCP servers, not organic customer traffic.',
      'The direct arm uses deterministic local parsing after the full result reaches the client; it does not measure model accuracy.',
      'Fixture setup calls are excluded equally from both arms, and package download time is not measured.',
      'Visible bytes count data-bearing MCP responses only, not initialization or tool catalogs.',
      'The benchmark measures exact result-boundary disclosure and response bytes, not provider tokens, cost, latency, or semantic side channels.',
    ],
  };
  if (process.argv.includes('--write')) writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  removeTemporary();
  process.removeListener('exit', removeTemporary);
}
