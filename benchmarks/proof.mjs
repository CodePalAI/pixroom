// Arm E — PROOF: does pixroom dominate headroom-only and pxpipe-only?
//
// Follows headroom's benchmarking route (benchmarks/comprehensive_eval.py,
// real_world_agent_benchmark.py): named realistic scenarios, baseline vs
// treatment, INPUT-TOKEN savings measured from before/after (headroom's own
// principle: "input compression is a pure function, so tokens_before/after are
// both observable" — output_savings.py), savings derived from SUMMED counts
// (never averaged %), signed/honest.
//
// Measuring input tokens offline eliminates the cache / agentic / base-URL
// confounds that muddied the live Claude arm. One consistent basis across all
// configs: gpt-tokenizer for text + Anthropic's EXACT image formula (ceil w*h/750)
// for optical (this is how Anthropic bills images, not an estimate).
//
// The provable thesis (Pareto-domination): because the two engines compress
// DISJOINT regions (optical→static slab, semantic→tool outputs), pixroom's
// output is <= min(headroom-only, pxpipe-only) on every workload, and strictly
// smaller when BOTH regions are compressible (the common agent case). Equality
// only when the other region is empty/incompressible — which we include on
// purpose (slab-heavy, tools-heavy) to be honest about where it merely ties.

import { spawn } from 'node:child_process';
import { accessSync, constants, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createPixroom } from '../dist/index.js';
import { EVIDENCE } from './evidence.mjs';
import {
  countTokens,
  effectiveTokens,
  makeSystemSlab,
  makeJsonToolResult,
  makeLogToolResult,
  makeCodeToolResult,
} from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const HEADROOM_PORT = 8787;
const sidecarUrl = `http://127.0.0.1:${HEADROOM_PORT}`;
const MODEL = 'claude-fable-5'; // pxpipe-supported so optical engages

// ── headroom sidecar lifecycle (semantic configs need /v1/compress) ──────────
function isExec(p) {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
function locateHeadroom() {
  return (
    [process.env.PIXROOM_HEADROOM_BIN, join(homedir(), 'repos-pixroom', '.headroom-venv', 'bin', 'headroom')]
      .filter(Boolean)
      .find(isExec) || 'headroom'
  );
}
function waitHealth(url, ms = 20000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + ms;
    const tick = async () => {
      try {
        const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
        if (r.ok) return resolve(true);
      } catch {
        /* not up */
      }
      if (Date.now() > deadline) return resolve(false);
      setTimeout(tick, 400);
    };
    tick();
  });
}

// ── scenarios (headroom-style: realistic agent context + tool outputs) ───────
function buildScenarios() {
  const bigSlab = makeSystemSlab(); // ~18k-char agent system prompt + tool schemas
  const tinySlab = 'You are a concise coding assistant.';
  const tinyTool = 'Result: operation completed successfully. No further data.';
  return [
    {
      name: 'mixed-json',
      category: 'mixed',
      slab: bigSlab,
      tools: [makeJsonToolResult(150)],
      note: 'big static slab + large JSON tool output (both regions)',
    },
    {
      name: 'mixed-logs',
      category: 'mixed',
      slab: bigSlab,
      tools: [makeLogToolResult(400)],
      note: 'big static slab + verbose build log (both regions)',
    },
    {
      name: 'mixed-code',
      category: 'mixed',
      slab: bigSlab,
      tools: [makeCodeToolResult(repoRoot)],
      note: 'big static slab + source-code tool output (both regions)',
    },
    {
      name: 'slab-heavy',
      category: 'slab-heavy',
      slab: bigSlab,
      tools: [tinyTool],
      note: 'big slab, negligible tool output (only optical helps)',
    },
    {
      name: 'tools-heavy',
      category: 'tools-heavy',
      slab: tinySlab,
      tools: [makeJsonToolResult(220)],
      note: 'negligible slab, big JSON output (only semantic helps)',
    },
  ];
}

function buildBody(sc) {
  return {
    model: MODEL,
    system: [{ type: 'text', text: sc.slab, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyze the attached tool output and answer the question.' },
          ...sc.tools.map((t, i) => ({ type: 'tool_result', tool_use_id: `t${i}`, content: t })),
        ],
      },
    ],
  };
}

// protect_recent:0 matches headroom's eval convention (compress the full tool context).
const CONFIGS = {
  'headroom-only': {
    optical: { enabled: false },
    semantic: { enabled: true, sidecarUrl, autoSpawn: false, protectRecent: 0 },
  },
  'pxpipe-only': { optical: { enabled: true }, semantic: { enabled: false } },
  pixroom: {
    optical: { enabled: true },
    semantic: { enabled: true, sidecarUrl, autoSpawn: false, protectRecent: 0 },
  },
};

async function measure(cfgOverrides, body) {
  const px = createPixroom({ ...cfgOverrides, logLevel: 'silent' });
  const routed = await px.route('anthropic', MODEL, structuredClone(body), 'payg');
  const tokens = effectiveTokens(routed.body, routed.report);
  await px.shutdown();
  return tokens;
}

async function main() {
  const child = spawn(locateHeadroom(), ['proxy', '--port', String(HEADROOM_PORT)], {
    cwd: repoRoot,
    env: { ...process.env, HEADROOM_MODE: 'cache' },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const ok = await waitHealth(sidecarUrl);
  if (!ok) console.error('WARNING: headroom sidecar not healthy — semantic configs will degrade.');

  const scenarios = buildScenarios();
  const results = {
    evidenceLevel: EVIDENCE.OFFLINE_REAL_TRANSFORM,
    model: MODEL,
    sidecar: ok,
    generatedAt: new Date().toISOString(),
    scenarios: [],
  };

  for (const sc of scenarios) {
    const body = buildBody(sc);
    const raw = countTokens(JSON.stringify(body));
    const headroom = await measure(CONFIGS['headroom-only'], body);
    const pxpipe = await measure(CONFIGS['pxpipe-only'], body);
    const pixroom = await measure(CONFIGS.pixroom, body);
    const best = Math.min(headroom, pxpipe);
    const entry = {
      name: sc.name,
      category: sc.category,
      note: sc.note,
      raw,
      headroom,
      pxpipe,
      pixroom,
      dominates: pixroom <= best + 2, // ≤ better single engine (2-tok tolerance for rounding)
      strictWin: pixroom < best - 2, // strictly better than both
    };
    results.scenarios.push(entry);
    const s = (n) => `${(((raw - n) / raw) * 100).toFixed(0)}%`;
    console.log(
      `${sc.name.padEnd(12)} raw=${raw} hr=${headroom}(${s(headroom)}) px=${pxpipe}(${s(pxpipe)}) pixroom=${pixroom}(${s(pixroom)}) ${entry.strictWin ? 'STRICT-WIN' : entry.dominates ? 'ties-best' : 'LOSES'}`,
    );
  }

  // Verdict
  const dominatesAll = results.scenarios.every((e) => e.dominates);
  const strictOnMixed = results.scenarios.filter((e) => e.category === 'mixed').every((e) => e.strictWin);
  results.verdict = { dominatesAll, strictOnMixed };
  console.log(`\nVERDICT: dominates-all=${dominatesAll}  strict-win-on-mixed=${strictOnMixed}`);

  mkdirSync(join(here, 'results'), { recursive: true });
  writeFileSync(join(here, 'results', 'proof.json'), JSON.stringify(results, null, 2));

  if (!child.killed) child.kill('SIGKILL');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode || 0), 300));
