import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { arch, platform, release, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const resultPath = join(
  root,
  'benchmarks',
  'results',
  'opaque-flow-model-check.first-party-macos-arm64-20260715.json',
);

function fingerprint(path) {
  return createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
}

const versionRun = spawnSync('spin', ['-V'], { cwd: root, encoding: 'utf8' });
if (versionRun.status !== 0) {
  console.error('Spin is required. Install Spin 6.5.2 or newer, then rerun npm run formal:opaque-flow.');
  process.exit(1);
}

const temporary = mkdtempSync(join(tmpdir(), 'pinpoint-spin-model-'));
copyFileSync(join(root, 'formal', 'opaque_flow.pml'), join(temporary, 'opaque_flow.pml'));
let run;
try {
  run = spawnSync('spin', ['-run', '-m1000000', 'opaque_flow.pml'], {
    cwd: temporary,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;

function number(pattern, label) {
  const match = output.match(pattern);
  if (!match?.[1]) throw new Error(`Spin output is missing ${label}`);
  return Number(match[1]);
}

const errors = number(/errors:\s*(\d+)/, 'error count');
const statesStored = number(/(\d+) states, stored/, 'stored-state count');
const statesMatched = number(/(\d+) states, matched/, 'matched-state count');
const transitions = number(/(\d+) transitions/, 'transition count');
const depthReached = number(/depth reached\s+(\d+)/, 'search depth');
const unreached = number(/\((\d+) of \d+ states\)/, 'unreached-state count');
const mutationRun = spawnSync(
  process.execPath,
  [join(root, 'scripts', 'check-opaque-flow-model-mutation.mjs')],
  { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
);
if (mutationRun.status !== 0) {
  console.error(`${mutationRun.stdout}${mutationRun.stderr}`);
  throw new Error('opaque-flow mutation sensitivity check failed');
}
const mutation = JSON.parse(mutationRun.stdout);

const result = {
  schemaVersion: 1,
  evidenceLevel: 'bounded-model-check',
  kind: 'mcp-value-opaque-flow-reference-model',
  date: new Date().toISOString().slice(0, 10),
  passed: run.status === 0 && errors === 0 && unreached === 0,
  environment: {
    platform: platform(),
    release: release(),
    architecture: arch(),
    node: process.version,
    spin: `${versionRun.stdout}${versionRun.stderr}`.trim(),
  },
  model: {
    path: 'formal/opaque_flow.pml',
    maxStepsPerTrace: 10,
    depthReached,
    statesStored,
    statesMatched,
    transitions,
    unreachedControlStates: unreached,
    assertionViolations: errors,
  },
  mutationSensitivity: mutation,
  checkedProperties: [
    'No selected value becomes visible on the modeled client boundary.',
    'Destination dispatch implies every modeled policy predicate held.',
    'Every destination dispatch emits exactly one receipt.',
    'Receipt sequence advances by exactly one and links to the previous sequence.',
  ],
  hostileActions: [
    'invalid catalog',
    'direct destination',
    'direct query',
    'resource read',
    'forged capability',
    'fixed-predicate override',
    'malformed protected source',
    'late upstream output',
    'independent policy-predicate failures',
  ],
  source: {
    fingerprints: {
      'formal/opaque_flow.pml': fingerprint('formal/opaque_flow.pml'),
      'scripts/check-opaque-flow-model.mjs': fingerprint('scripts/check-opaque-flow-model.mjs'),
      'scripts/check-opaque-flow-model-mutation.mjs': fingerprint('scripts/check-opaque-flow-model-mutation.mjs'),
    },
  },
  limitations: [
    'This is a bounded abstract reference model, not a proof over the TypeScript implementation or Node runtime.',
    'The search bounds each trace to ten actions over finite Boolean policy predicates.',
    'Cryptography, JSON parsing, OS isolation, timing, cardinality, and upstream-process behavior are abstracted.',
    'Implementation conformance is tested separately by protocol integration and live-host gates.',
  ],
};

if (process.argv.includes('--write')) {
  writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
}
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;