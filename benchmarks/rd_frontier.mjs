// RD-FRONTIER — the cross-modal rate–distortion characterization.
//
// Controller simulation: for each content type and engine, sweep hand-authored
// compression ratios and retrieval probabilities. This checks planner/controller
// behavior only; it is not an empirical or competitive RD frontier.
//
// Regret comes from the simulated oracle (src/policy/oracle.ts), whose per-engine
// distortion model is mechanistically grounded and stated openly (see that file):
// optical preserves verbatim ids via its factsheet but distorts reasoning-access;
// semantic keeps text readable under a must-keep guard. The oracle is a simulation
// to be replaced by live retrieval events when an API key is available.
//
// Reproduce: npm run build && node benchmarks/rd_frontier.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  ENGINES,
  CONTENT_TYPES,
  expectedRegret,
  bestEngineByRegret,
  idQueryFraction,
  mustKeepDensity,
} from '../dist/policy/oracle.js';
import {
  makeJsonToolResult,
  makeLogToolResult,
  makeCodeToolResult,
  makeProseContext,
  mdTable,
  pct,
} from './lib.mjs';
import { EVIDENCE } from './evidence.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

// Ratio sweep: compressed/original. Lower = more aggressive = more savings.
const RATIOS = [0.9, 0.75, 0.6, 0.45, 0.3, 0.2, 0.12];
// Operating point used for the winner map (~55% savings).
const TARGET_RATIO = 0.45;

/** A representative region per content type, so the oracle sees real id density. */
function sampleText(ct) {
  switch (ct) {
    case 'json':
      return makeJsonToolResult(120);
    case 'log':
      return makeLogToolResult(300);
    case 'code':
      return makeCodeToolResult(repoRoot);
    case 'prose':
      return makeProseContext(6000, 11);
    default:
      return '';
  }
}

const samples = Object.fromEntries(CONTENT_TYPES.map((ct) => [ct, sampleText(ct)]));

// ── Build the frontier data ──────────────────────────────────────────────────
const frontier = {}; // ct → { engine → [{ savings, regret }] }
for (const ct of CONTENT_TYPES) {
  frontier[ct] = {};
  for (const engine of ENGINES) {
    frontier[ct][engine] = RATIOS.map((r) => ({
      ratio: r,
      savings: 1 - r,
      regret: expectedRegret(engine, ct, r, samples[ct]),
    }));
  }
}

// Winner map at the target operating point.
const winners = {};
for (const ct of CONTENT_TYPES) {
  winners[ct] = {
    engine: bestEngineByRegret(ct, TARGET_RATIO, samples[ct]),
    idFraction: idQueryFraction(ct, samples[ct]),
    idDensity: mustKeepDensity(samples[ct]),
    regret: Object.fromEntries(
      ENGINES.map((e) => [e, expectedRegret(e, ct, TARGET_RATIO, samples[ct])]),
    ),
  };
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log('\n=== Simulated rate–distortion surface ===\n');
for (const ct of CONTENT_TYPES) {
  const idf = winners[ct].idFraction;
  console.log(`content=${ct}  id-query-fraction≈${idf.toFixed(2)}  id-density≈${winners[ct].idDensity.toFixed(3)}`);
  const rows = RATIOS.map((r, i) => {
    const o = frontier[ct].optical[i].regret;
    const s = frontier[ct].semantic[i].regret;
    const front = o <= s ? 'optical' : 'semantic';
    return [
      pct(1 - r),
      o.toFixed(3),
      s.toFixed(3),
      `${front} (${Math.min(o, s).toFixed(3)})`,
    ];
  });
  console.log(mdTable(['savings', 'optical regret', 'semantic regret', 'frontier'], rows));
  console.log('');
}

console.log(`=== Winner map @ ${pct(1 - TARGET_RATIO)} savings ===\n`);
const winnerRows = CONTENT_TYPES.map((ct) => [
  ct,
  winners[ct].engine,
  winners[ct].regret.optical.toFixed(3),
  winners[ct].regret.semantic.toFixed(3),
]);
console.log(mdTable(['content type', 'best engine', 'optical regret', 'semantic regret'], winnerRows));

const distinct = new Set(CONTENT_TYPES.map((ct) => winners[ct].engine));
const crossModal = distinct.size > 1;
console.log('');
console.log(`SIMULATION cross-modal: ${crossModal ? 'PASS' : 'FAIL'} — planted winners span {${[...distinct].join(', ')}}`);
console.log(
  crossModal
    ? '  The hand-authored oracle contains different winners by content type; no real model was evaluated.'
    : '  One engine wins everywhere at this operating point; the frontier is not cross-modal here.',
);

// ── Persist ────────────────────────────────────────────────────────────────────
const resultsDir = join(here, 'results');
mkdirSync(resultsDir, { recursive: true });
const outPath = join(resultsDir, 'rd-frontier.json');
writeFileSync(
  outPath,
  JSON.stringify(
    {
      evidenceLevel: EVIDENCE.UNIT_SIMULATION,
      generatedAt: new Date().toISOString(),
      targetRatio: TARGET_RATIO,
      ratios: RATIOS,
      engines: ENGINES,
      contentTypes: CONTENT_TYPES,
      frontier,
      winners,
      crossModal,
      note:
        'Regret from the simulated oracle (mechanistic, documented assumptions). ' +
        'Replace with live retrieval events for a validated frontier.',
    },
    null,
    2,
  ),
);
console.log(`\nWrote ${outPath}`);

if (!crossModal) process.exitCode = 1;
