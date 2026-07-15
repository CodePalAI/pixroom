import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative as relativePath, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readmePath = join(root, 'README.md');
const readme = readFileSync(readmePath, 'utf8');
const receipt = JSON.parse(
  readFileSync(
    join(
      root,
      'benchmarks',
      'results',
      'evidence-gate.first-party-macos-arm64-20260715.json',
    ),
    'utf8',
  ),
);
const gatewayReceipt = JSON.parse(
  readFileSync(
    join(
      root,
      'benchmarks',
      'results',
      'mcp-gateway-agent.first-party-macos-arm64-20260715.json',
    ),
    'utf8',
  ),
);
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const proofAssetPath = join(root, 'assets', 'qcv-evidence-gate.svg');
const proofAsset = readFileSync(proofAssetPath, 'utf8');
const failures = [];

const fail = (message) => failures.push(message);
const integer = new Intl.NumberFormat('en-US');
const percentage = (value) => `${(value * 100).toFixed(1)}%`;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function githubSlug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}

function headingSlugs(markdown) {
  const counts = new Map();
  const slugs = new Set();
  for (const match of markdown.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = githubSlug(match[1]);
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    slugs.add(seen === 0 ? base : `${base}-${seen}`);
  }
  return slugs;
}

function localTargets(markdown) {
  const targets = [];
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) targets.push(match[1]);
  for (const match of markdown.matchAll(/\b(?:href|src)="([^"]+)"/g)) targets.push(match[1]);
  return targets;
}

function isPackaged(relativePath) {
  return packageJson.files.some((entry) => {
    if (entry.startsWith('!')) return false;
    const normalized = entry.replace(/\/$/, '');
    return relativePath === normalized || relativePath.startsWith(`${normalized}/`);
  });
}

const slugs = headingSlugs(readme);
for (const target of localTargets(readme)) {
  if (target.startsWith('#')) {
    const anchor = decodeURIComponent(target.slice(1));
    if (!slugs.has(anchor)) fail(`README anchor does not exist: ${target}`);
    continue;
  }
  if (/^(?:https?:|mailto:)/.test(target)) continue;
  const [relative] = decodeURIComponent(target).split('#');
  if (!relative) continue;
  const absolute = resolve(dirname(readmePath), relative);
  const relativeToRoot = relativePath(root, absolute);
  if (
    relativeToRoot === '..' ||
    relativeToRoot.startsWith(`..${sep}`) ||
    isAbsolute(relativeToRoot)
  ) {
    fail(`README local target escapes the repository: ${target}`);
  } else if (!existsSync(absolute)) {
    fail(`README local target does not exist: ${target}`);
  } else {
    const packagePath = relativeToRoot.split(sep).join('/');
    if (packagePath && !isPackaged(packagePath)) {
      fail(`README local target is omitted from package.json files: ${target}`);
    }
  }
}

const { methodology } = receipt;
const headroom = receipt.summary.arms.headroom;
const qcv = receipt.summary.arms.qcv;
const comparison = receipt.summary.comparisons.qcvVsHeadroom;
const evidenceStrings = [
  integer.format(headroom.inputTokens),
  integer.format(qcv.inputTokens),
  percentage(comparison.costReduction),
  `${headroom.correct}/${headroom.observations}`,
  `${qcv.correct}/${qcv.observations}`,
  `${(comparison.harmRateOneSided95Upper * 100).toFixed(2)}%`,
];
for (const value of evidenceStrings) {
  if (!readme.includes(value)) fail(`README is missing paid-receipt value: ${value}`);
  if (!proofAsset.includes(value)) fail(`proof asset is missing paid-receipt value: ${value}`);
}

for (const value of [
  `$${receipt.summary.arms.raw.costUSD.toFixed(6)}`,
  `$${headroom.costUSD.toFixed(6)}`,
  `$${qcv.costUSD.toFixed(6)}`,
  percentage(receipt.summary.comparisons.qcvVsRaw.costReduction),
  percentage(comparison.inputReduction),
]) {
  if (!readme.includes(value)) fail(`README is missing provider-wire receipt value: ${value}`);
}

for (const value of [
  integer.format(gatewayReceipt.result.upstreamStructuredChars),
  integer.format(gatewayReceipt.result.largestModelVisibleToolResultChars),
  percentage(gatewayReceipt.result.modelVisibleCharacterReduction),
  gatewayReceipt.result.expected,
]) {
  if (!readme.includes(value)) fail(`README is missing MCP gateway receipt value: ${value}`);
}
for (const [sourcePath, expectedHash] of Object.entries(gatewayReceipt.source.fingerprints)) {
  const absolute = join(root, sourcePath);
  if (!existsSync(absolute)) {
    fail(`MCP gateway receipt source does not exist: ${sourcePath}`);
    continue;
  }
  const actualHash = sha256(readFileSync(absolute));
  if (actualHash !== expectedHash) {
    fail(`MCP gateway receipt fingerprint is stale: ${sourcePath}`);
  }
}

if (!readme.includes('./assets/qcv-evidence-gate.svg')) fail('README does not render the proof asset');
if (!existsSync(join(root, 'llms.txt'))) fail('llms.txt is missing');
if (!readme.includes('./llms.txt')) fail('README does not link llms.txt');
const endUserSignals = [
  'The lossless MCP result firewall for AI agents',
  'Stop oversized MCP results before they hit the context window.',
  '## What changes at the tool boundary',
  '## Get started (60 seconds)',
  '## What it does',
  '## Works with your stack',
  '## Choose your path',
  '### MCP gateway: the main path',
  '### TypeScript SDK: native client in, native response out',
  '### Any language or HTTP client: change the base URL',
  'Subscription-compatible',
  '## What passes through',
  '### Provider-wire QCV: the secondary path',
  '### Real Claude Code MCP gateway gate',
  'pinpoint mcp gateway --',
  'Provider API key',
];
for (const signal of endUserSignals) {
  if (!readme.includes(signal)) fail(`README is missing end-user onboarding signal: ${signal}`);
}
if (/[]/.test(readme)) fail('README contains control characters');
if (/[—–“”]/.test(readme)) fail('README contains non-ASCII dash or quote punctuation');

const visibleReadme = readme.replace(/<!--[^]*?-->/g, '');
const waitingForNpm = readme.includes('LAUNCH(npm)');
if (waitingForNpm) {
  if (!visibleReadme.includes('git clone https://github.com/CodePalAI/pinpoint.git')) {
    fail('pre-npm README is missing the verified public clone command');
  }
  if (!visibleReadme.includes('npm install && npm link')) {
    fail('pre-npm README is missing the verified checkout CLI setup');
  }
  if (!visibleReadme.includes('npm install /path/to/pinpoint')) {
    fail('pre-npm README is missing the local-directory SDK install');
  }
  for (const unavailable of [
    'npm install -g @codepal/pinpoint',
    'npm install @codepal/pinpoint',
    'npx @codepal/pinpoint demo',
  ]) {
    if (visibleReadme.includes(unavailable)) fail(`README advertises unpublished npm path: ${unavailable}`);
  }
  if (visibleReadme.includes('git+https://github.com/CodePalAI/pinpoint.git')) {
    fail('README advertises the unreliable npm Git-dependency path');
  }
} else {
  for (const required of [
    'npm install -g @codepal/pinpoint',
    'npm install @codepal/pinpoint',
    'npx @codepal/pinpoint demo',
  ]) {
    if (!visibleReadme.includes(required)) fail(`release README is missing npm path: ${required}`);
  }
  if (visibleReadme.includes('git+https://github.com/CodePalAI/pinpoint.git')) {
    fail('release README still advertises Git installation');
  }
}

if (failures.length > 0) {
  console.error(`README check failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log(
  `README check: ok (${slugs.size} headings, ${localTargets(readme).length} links/assets, receipt synchronized)`,
);