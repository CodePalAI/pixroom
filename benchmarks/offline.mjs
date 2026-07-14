// Arm A — offline 3-way: identical Copilot-shaped payloads through pxpipe-only,
// headroom-only, and pixroom (both). Measures effective input-token reduction with
// one consistent basis. No model calls, no API key. Requires a headroom sidecar
// (PIXROOM_HEADROOM_URL) for the semantic configs.

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createPixroom } from '../dist/index.js';
import { buildPayloads, countTokens, effectiveTokens } from './lib.mjs';
import { EVIDENCE } from './evidence.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const MODEL = process.env.PIXROOM_OPTICAL_BENCH_MODEL || 'claude-fable-5';
const sidecarUrl = process.env.PIXROOM_HEADROOM_URL || 'http://127.0.0.1:8787';

const CONFIGS = {
  'pxpipe-only': { optical: { enabled: true }, semantic: { enabled: false } },
  'headroom-only': {
    optical: { enabled: false },
    // protectRecent: 0 — these synthetic payloads are single-turn; treat the tool
    // output as an older (compressible) turn, the steady-state agent scenario.
    semantic: { enabled: true, sidecarUrl, autoSpawn: false, protectRecent: 0 },
  },
  pixroom: {
    optical: { enabled: true },
    semantic: { enabled: true, sidecarUrl, autoSpawn: false, protectRecent: 0 },
  },
};

function stageRows(report) {
  return report.rows.map((r) => ({
    stage: r.stage,
    applied: r.applied,
    reason: r.reason,
    tokensText: r.tokensText,
    tokensCompressed: r.tokensCompressed,
    basis: r.basis,
  }));
}

async function run() {
  const payloads = buildPayloads(repoRoot);
  let sidecarStatus = 'unknown';

  const results = {
    evidenceLevel: EVIDENCE.OFFLINE_REAL_TRANSFORM,
    model: MODEL,
    sidecarUrl,
    generatedAt: new Date().toISOString(),
    payloads: [],
  };

  for (const p of payloads) {
    const baselineTokens = countTokens(JSON.stringify(p.body));
    const entry = { name: p.name, description: p.description, baselineTokens, configs: {} };

    for (const [cfgName, overrides] of Object.entries(CONFIGS)) {
      const px = createPixroom({ ...overrides, logLevel: 'silent' });
      if (overrides.semantic?.enabled) {
        const { sidecar } = await px.warmup();
        sidecarStatus = sidecar;
      }
      const routed = await px.route('anthropic', MODEL, structuredClone(p.body), 'payg');
      const eff = effectiveTokens(routed.body, routed.report);
      entry.configs[cfgName] = {
        effectiveTokens: eff,
        savedTokens: baselineTokens - eff,
        savedFraction: baselineTokens > 0 ? (baselineTokens - eff) / baselineTokens : 0,
        reversible: routed.reversible.length,
        opticalOwnsCacheControl: routed.opticalOwnsCacheControl,
        stages: stageRows(routed.report),
      };
      await px.shutdown();
    }
    results.payloads.push(entry);
  }

  results.sidecarStatus = sidecarStatus;
  mkdirSync(join(here, 'results'), { recursive: true });
  writeFileSync(join(here, 'results', 'offline.json'), JSON.stringify(results, null, 2));
  console.log(`offline arm done — sidecar=${sidecarStatus}, payloads=${results.payloads.length}`);
  for (const p of results.payloads) {
    const line = Object.entries(p.configs)
      .map(([k, v]) => `${k}:${(v.savedFraction * 100).toFixed(1)}%`)
      .join('  ');
    console.log(`  ${p.name.padEnd(12)} base=${p.baselineTokens}  ${line}`);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
