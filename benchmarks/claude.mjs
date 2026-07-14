// Arm D — live Claude Code 4-way (baseline / headroom-only / pxpipe-only / pixroom).
//
// Claude Code uses ANTHROPIC_BASE_URL, so pxpipe and pixroom are the REAL front door
// here (no delegation) — the fair live comparison Copilot couldn't give us. We read
// ground-truth token usage (incl. the prompt-cache breakdown) from `claude
// --output-format json`, so we can see whether compression helps or BUSTS the cache.
//
// Uses the real Claude subscription (no API key). optical is off on opus (out of
// pxpipe scope + subscription stealth), so this arm measures the semantic engine +
// cache interaction on live agent traffic.

import { spawn } from 'node:child_process';
import net from 'node:net';
import { accessSync, constants, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { copilotSuite, stripAnsi } from './lib.mjs';
import { EVIDENCE, liveEvidenceForKind } from './evidence.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const MODEL = process.env.BENCH_MODEL || 'claude-opus-4-8';
const QUICK = process.env.BENCH_QUICK === '1';
const CALL_TIMEOUT_MS = Number(process.env.BENCH_TIMEOUT_MS || 120000);
// Claude Code is classified 'subscription' → pixroom optical is stealth-gated off by
// default. Set PIXROOM_OPTICAL_ON_SUBSCRIPTION=1 to let optical engage (needed to show
// the optical stage on a pxpipe-supported model like fable-5).
const OPTICAL_ON_SUB = process.env.PIXROOM_OPTICAL_ON_SUBSCRIPTION || '0';
const MODEL_SLUG = MODEL.replace(/[^a-z0-9]+/gi, '-');

const HEADROOM_PORT = 8787;
const PXPIPE_PORT = 8790;
const PIXROOM_PORT = 8788;

function isExec(p) {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
function locateHeadroom() {
  const c = [
    process.env.PIXROOM_HEADROOM_BIN,
    join(homedir(), 'repos-pixroom', '.headroom-venv', 'bin', 'headroom'),
  ].filter(Boolean);
  return c.find(isExec) || 'headroom';
}

function waitHealth(url, ms = 20000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + ms;
    const tick = async () => {
      try {
        const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
        if (r.ok) return resolve(true);
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) return resolve(false);
      setTimeout(tick, 400);
    };
    tick();
  });
}
function waitPort(port, ms = 20000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + ms;
    const tick = () => {
      const s = net.connect(port, '127.0.0.1');
      s.on('connect', () => {
        s.destroy();
        resolve(true);
      });
      s.on('error', () => {
        s.destroy();
        if (Date.now() > deadline) resolve(false);
        else setTimeout(tick, 400);
      });
    };
    tick();
  });
}

const children = [];
function startProxy(cmd, args, env, label) {
  const child = spawn(cmd, args, { cwd: repoRoot, env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => (err += d.toString()));
  child.on('exit', (code) => {
    if (code && code !== 0 && code !== null) console.error(`[${label}] exited ${code}: ${err.slice(-300)}`);
  });
  children.push(child);
  return child;
}
function killAll() {
  for (const c of children) {
    try {
      if (!c.killed) c.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
}

function runClaude(baseUrl, prompt) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl;
    else delete env.ANTHROPIC_BASE_URL;
    const start = Date.now();
    const child = spawn('claude', ['--model', MODEL, '--output-format', 'json', '-p', prompt], {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, CALL_TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ out, err, code, ms: Date.now() - start, timedOut });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ out, err: err + String(e), code: 127, ms: Date.now() - start, timedOut });
    });
  });
}

function parseUsage(raw) {
  const text = stripAnsi(raw).trim();
  let obj = null;
  try {
    obj = JSON.parse(text);
  } catch {
    // find the last JSON object line with a usage field
    for (const line of text.split('\n').reverse()) {
      const t = line.trim();
      if (t.startsWith('{') && t.includes('"usage"')) {
        try {
          obj = JSON.parse(t);
          break;
        } catch {
          /* keep scanning */
        }
      }
    }
  }
  if (!obj) return null;
  const u = obj.usage || {};
  const input = u.input_tokens ?? 0;
  const cacheCreate = u.cache_creation_input_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const output = u.output_tokens ?? 0;
  return {
    result: typeof obj.result === 'string' ? obj.result : JSON.stringify(obj.result ?? ''),
    input,
    cacheCreate,
    cacheRead,
    output,
    totalInput: input + cacheCreate + cacheRead,
    billedInput: Math.round(input + 1.25 * cacheCreate + 0.1 * cacheRead),
  };
}

const CONFIGS = [
  { name: 'baseline', baseUrl: null },
  { name: 'headroom-only', baseUrl: `http://127.0.0.1:${HEADROOM_PORT}` },
  { name: 'pxpipe-only', baseUrl: `http://127.0.0.1:${PXPIPE_PORT}` },
  { name: 'pixroom', baseUrl: `http://127.0.0.1:${PIXROOM_PORT}` },
];

async function main() {
  const headroomBin = locateHeadroom();
  const pxpipeBin = join(repoRoot, 'node_modules', '.bin', 'pxpipe');

  console.log('starting proxies...');
  startProxy(headroomBin, ['proxy', '--port', String(HEADROOM_PORT)], { HEADROOM_MODE: 'cache' }, 'headroom');
  startProxy(pxpipeBin, [], { PORT: String(PXPIPE_PORT) }, 'pxpipe');
  const hOk = await waitHealth(`http://127.0.0.1:${HEADROOM_PORT}`);
  const pOk = await waitPort(PXPIPE_PORT);
  // pixroom proxy needs the headroom sidecar (8787) already up.
  startProxy(
    'node',
    ['bin/cli.js', 'proxy'],
    {
      PIXROOM_PORT: String(PIXROOM_PORT),
      PIXROOM_HEADROOM_URL: `http://127.0.0.1:${HEADROOM_PORT}`,
      PIXROOM_HEADROOM_AUTOSPAWN: '0',
      PIXROOM_OPTICAL_ON_SUBSCRIPTION: OPTICAL_ON_SUB,
      PIXROOM_LOG: 'warn',
    },
    'pixroom',
  );
  const pxOk = await waitHealth(`http://127.0.0.1:${PIXROOM_PORT}`);
  console.log(`proxies: headroom=${hOk} pxpipe=${pOk} pixroom=${pxOk}`);

  const suite = QUICK ? copilotSuite(repoRoot).slice(0, 1) : copilotSuite(repoRoot);
  const results = {
    evidenceLevel: EVIDENCE.LIVE_AGENTIC,
    model: MODEL,
    opticalOnSubscription: OPTICAL_ON_SUB === '1',
    generatedAt: new Date().toISOString(),
    proxies: { hOk, pOk, pxOk },
    runs: [],
  };

  for (const item of suite) {
    const entry = {
      evidenceLevel: liveEvidenceForKind(item.kind),
      id: item.id,
      kind: item.kind,
      prompt: item.prompt,
      expected: item.expected,
      results: {},
    };
    for (const cfg of CONFIGS) {
      const r = await runClaude(cfg.baseUrl, item.prompt);
      const u = parseUsage(r.out);
      const clean = u ? u.result : stripAnsi(r.out).replace(/\s+/g, ' ').trim().slice(0, 200);
      entry.results[cfg.name] = {
        ok: !r.timedOut && r.code === 0 && !!u,
        ms: r.ms,
        correct: item.check(clean || ''),
        input: u?.input ?? null,
        cacheCreate: u?.cacheCreate ?? null,
        cacheRead: u?.cacheRead ?? null,
        output: u?.output ?? null,
        totalInput: u?.totalInput ?? null,
        billedInput: u?.billedInput ?? null,
        snippet: (clean || '(no output)').slice(0, 200),
        error: u ? undefined : (r.err || r.out).slice(0, 200),
      };
      const e = entry.results[cfg.name];
      console.log(`  [${item.id}] ${cfg.name.padEnd(14)} total=${e.totalInput} billed=${e.billedInput} correct=${e.correct} ${(e.ms / 1000).toFixed(1)}s`);
    }
    results.runs.push(entry);
  }

  mkdirSync(join(here, 'results'), { recursive: true });
  writeFileSync(join(here, 'results', `claude-${MODEL_SLUG}.json`), JSON.stringify(results, null, 2));
  console.log(`\nclaude arm done — model=${MODEL} (optical-on-sub=${OPTICAL_ON_SUB}), runs=${results.runs.length}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    killAll();
    setTimeout(() => process.exit(process.exitCode || 0), 500);
  });
