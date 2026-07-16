import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'pinpoint-package-smoke-'));
const run = (command, args, cwd = temporary) =>
  execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const publicEntries = [
  '@codepal/pinpoint',
  '@codepal/pinpoint/anthropic',
  '@codepal/pinpoint/openai',
  '@codepal/pinpoint/sdk',
  '@codepal/pinpoint/proxy',
  '@codepal/pinpoint/router',
  '@codepal/pinpoint/kernel',
  '@codepal/pinpoint/protocols',
  '@codepal/pinpoint/output',
  '@codepal/pinpoint/agents',
  '@codepal/pinpoint/virtual-context',
  '@codepal/pinpoint/capture',
  '@codepal/pinpoint/telemetry',
  '@codepal/pinpoint/mcp',
];

try {
  const packed = JSON.parse(
    run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], root),
  );
  const artifact = packed[0];
  if (!artifact || artifact.name !== '@codepal/pinpoint') {
    throw new Error('npm pack returned the wrong package identity');
  }
  const paths = new Set((artifact.files ?? []).map((file) => file.path));
  for (const required of [
    'README.md',
    'CODE_OF_CONDUCT.md',
    'LICENSE',
    'NOTICE',
    'bin/cli.js',
    'bin/verify-receipt.js',
    'examples/mcp-opaque-flow.json',
    'examples/mcp-opaque-flow.schema.json',
    'planning/value_opaque_mcp_dataflow.md',
    'planning/opaque_flow_formal_properties.md',
    'planning/breakthrough_scorecard.md',
    'formal/opaque_flow.pml',
    'benchmarks/results/mcp-opaque-flow.first-party-macos-arm64-20260715.json',
    'benchmarks/results/mcp-opaque-flow-cross-host.first-party-macos-arm64-20260715.json',
    'benchmarks/results/opaque-flow-model-check.first-party-macos-arm64-20260715.json',
    'benchmarks/results/mcp-oss-filesystem.first-party-macos-arm64-20260715.json',
  ]) {
    if (!paths.has(required)) throw new Error(`packed artifact is missing ${required}`);
  }

  writeFileSync(
    join(temporary, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }, null, 2),
  );
  run('npm', [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    join(temporary, artifact.filename),
  ]);

  const runtimeScript = [
    `const entries = ${JSON.stringify(publicEntries)};`,
    'for (const entry of entries) await import(entry);',
    "const { McpResultFirewall, MCP_FLOW_TOOL_NAME, MCP_QUERY_TOOL_NAME, parseMcpOpaqueFlowConfig, verifyMcpOpaqueFlowReceipt } = await import('@codepal/pinpoint/mcp');",
    'const firewall = new McpResultFirewall({ minChars: 10 });',
    "const transformed = firewall.transformResult('smoke', { content: [{ type: 'text', text: JSON.stringify(Array.from({ length: 100 }, (_, id) => ({ id, value: `exact-smoke-value-${id}` }))) }] });",
    "if (!transformed.virtualized) throw new Error('public MCP firewall did not virtualize');",
    "const queried = firewall.callTool(MCP_QUERY_TOOL_NAME, { id: transformed.descriptor.id, op: 'json_select', where: { id: 73 }, fields: ['value'] });",
    "if (!queried.content[0].text.includes('exact-smoke-value-73')) throw new Error('public MCP query did not recover exact value');",
    "const flowConfig = parseMcpOpaqueFlowConfig({ version: 1, flows: [{ name: 'smoke_flow', sourceTool: 'source', sourceKind: 'json-array', destinationTool: 'destination', destinationArgument: 'records', allowedOps: ['json_select'], allowedFields: ['value'] }] });",
    "if (MCP_FLOW_TOOL_NAME !== 'pinpoint_flow' || flowConfig.exposeQueryTool || !flowConfig.opaqueArtifactIds) throw new Error('public opaque-flow config defaults are invalid');",
    "if (verifyMcpOpaqueFlowReceipt({})) throw new Error('public receipt verifier accepted an invalid receipt');",
    'console.log(`imported ${entries.length} public entry points`);',
  ].join('\n');
  run(process.execPath, ['--input-type=module', '--eval', runtimeScript]);

  const bindings = publicEntries.map((entry, index) => `import * as entry${index} from '${entry}';`);
  bindings.push(`void [${publicEntries.map((_, index) => `entry${index}`).join(', ')}];`);
  writeFileSync(join(temporary, 'smoke.mts'), `${bindings.join('\n')}\n`);
  run(process.execPath, [
    join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--strict',
    '--noEmit',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--target',
    'ES2022',
    '--skipLibCheck',
    'smoke.mts',
  ]);

  const cli = join(temporary, 'node_modules', '@codepal', 'pinpoint', 'bin', 'cli.js');
  const receiptVerifier = join(temporary, 'node_modules', '@codepal', 'pinpoint', 'bin', 'verify-receipt.js');
  if (run(process.execPath, [cli, '--version']).trim() !== artifact.version) {
    throw new Error('installed CLI version does not match the packed version');
  }
  run(process.execPath, [cli, '--help']);
  const demo = run(process.execPath, [cli, 'demo']);
  for (const expected of ['exact answer materialized: user733@example.com', 'network requests: 0']) {
    if (!demo.includes(expected)) throw new Error(`installed demo is missing: ${expected}`);
  }
  const installedReceipt = join(
    temporary,
    'node_modules',
    '@codepal',
    'pinpoint',
    'benchmarks',
    'results',
    'mcp-opaque-flow.first-party-macos-arm64-20260715.json',
  );
  const verification = JSON.parse(run(process.execPath, [
    receiptVerifier,
    installedReceipt,
    '--path',
    'firstReceipt',
  ]));
  if (verification.valid !== true) throw new Error('installed standalone receipt verifier failed');

  console.log(
    `package smoke: ok (${artifact.name}@${artifact.version}, ${publicEntries.length} exports, ${paths.size} files)`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
