// Arm G — CONTROLLER SIMULATION: does the policy recover an allocation planted in
// the same hand-authored oracle that supplies its feedback?
//
// This is a deterministic mechanism check, not product evidence. The controller starts at the STATIC
// policy (today: tool-result regions → semantic) and learns from simulated
// retrieval-regret (src/policy/oracle.ts). Over sessions it should discover the
// frontier result — route id-heavy json/log to optical, keep reasoning-heavy
// code/prose on semantic — and converge toward the offline-optimal allocation.
//
// Metrics per round (one session; controller cache reset, store persists):
//   - regret   = fraction of offloaded regions the model had to retrieve
//   - netSaved = mean net saved fraction: +savedFraction when not retrieved,
//                −ratio when retrieved (the compressed copy was wasted overhead)
//
// Reproduce: npm run build && node benchmarks/adaptive.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { PolicyStore } from '../dist/policy/store.js';
import { CrossModalController } from '../dist/policy/controller.js';
import { simulateRetrieval, expectedRegret, ENGINES } from '../dist/policy/oracle.js';
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

const ROUNDS = 60;
const WARMUP = 6; // sessions of heavier exploration before exploiting
const MIN_OFFERS = 4;
const PER_TYPE = 8;
const STEADY = 15; // rounds averaged for the steady-state comparison

// Characteristic compression ratio (compressed/original) each engine achieves per
// content type: optical images aggressively (big cut); semantic is moderate text
// compression. savedFraction = 1 − ratio.
const ENGINE_RATIO = {
  optical: { json: 0.28, log: 0.22, code: 0.5, prose: 0.3, mixed: 0.3, unknown: 0.3 },
  semantic: { json: 0.55, log: 0.5, code: 0.55, prose: 0.5, mixed: 0.55, unknown: 0.55 },
};
const savedFrac = (engine, ct) => 1 - ENGINE_RATIO[engine][ct];
const netSaved = (engine, ct, retrieved) =>
  retrieved ? -ENGINE_RATIO[engine][ct] : savedFrac(engine, ct);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildCorpus() {
  const regions = [];
  for (let i = 0; i < PER_TYPE; i++) {
    regions.push({ ct: 'json', text: makeJsonToolResult(60 + i * 12) });
    regions.push({ ct: 'log', text: makeLogToolResult(150 + i * 30) });
    regions.push({ ct: 'code', text: makeCodeToolResult(repoRoot) });
    regions.push({ ct: 'prose', text: makeProseContext(3500, i + 1) });
  }
  return regions;
}

// Fixed single-engine baseline (semantic = today's tool-result rule; optical = the
// always-image alternative).
function runStatic(engine, corpus, seed) {
  const rng = mulberry32(seed);
  const curve = [];
  for (let r = 0; r < ROUNDS; r++) {
    let retr = 0;
    let net = 0;
    for (const region of corpus) {
      const ratio = ENGINE_RATIO[engine][region.ct];
      const retrieved = simulateRetrieval(engine, region.ct, ratio, rng, region.text);
      retr += retrieved ? 1 : 0;
      net += netSaved(engine, region.ct, retrieved);
    }
    curve.push({ round: r + 1, regret: retr / corpus.length, netSaved: net / corpus.length });
  }
  return curve;
}

// Adaptive policy: controller learns from its own retrieval-regret across sessions.
function runAdaptive(corpus, seed) {
  const store = new PolicyStore();
  const rng = mulberry32(seed);
  const curve = [];
  for (let r = 0; r < ROUNDS; r++) {
    const exploreRate = r < WARMUP ? 0.6 : 0.0;
    const controller = new CrossModalController(
      store,
      { exploreRate, minOffers: MIN_OFFERS, sessionStable: true },
      rng,
    );
    let retr = 0;
    let net = 0;
    for (const region of corpus) {
      const { engine } = controller.chooseEngine({
        contentType: region.ct,
        eligible: ['optical', 'semantic'],
        defaultEngine: 'semantic',
        fallbackSaved: { optical: 0.72, semantic: 0.48 },
      });
      const ratio = ENGINE_RATIO[engine][region.ct];
      const retrieved = simulateRetrieval(engine, region.ct, ratio, rng, region.text);
      store.noteOffer(region.ct, engine);
      store.noteSaved(region.ct, engine, savedFrac(engine, region.ct));
      if (retrieved) store.noteRetrieval(region.ct, engine);
      retr += retrieved ? 1 : 0;
      net += netSaved(engine, region.ct, retrieved);
    }
    curve.push({ round: r + 1, regret: retr / corpus.length, netSaved: net / corpus.length });
  }
  return { curve, store };
}

// Offline-optimal ceiling: per content type, argmax expected net saved.
function optimalPolicy(corpus) {
  let retrSum = 0;
  let netSum = 0;
  const map = {};
  for (const region of corpus) {
    let best = 'semantic';
    let bestE = -Infinity;
    let bestRegret = 0;
    for (const engine of ENGINES) {
      const ratio = ENGINE_RATIO[engine][region.ct];
      const regret = expectedRegret(engine, region.ct, ratio, region.text);
      const e = (1 - regret) * savedFrac(engine, region.ct) + regret * -ratio;
      if (e > bestE) {
        bestE = e;
        best = engine;
        bestRegret = regret;
      }
    }
    map[region.ct] = best;
    retrSum += bestRegret;
    netSum += bestE;
  }
  return { regret: retrSum / corpus.length, netSaved: netSum / corpus.length, map };
}

// What the controller actually learned: per content type, the engine with the
// higher posterior mean utility.
function learnedMap(store) {
  const map = {};
  for (const ct of ['json', 'log', 'code', 'prose']) {
    let best = 'semantic';
    let bestU = -Infinity;
    for (const engine of ENGINES) {
      const saved = store.savedMean(ct, engine, 0.5);
      const regret = store.regretMean(ct, engine);
      const u = saved - regret;
      if (store.get(ct, engine).offers > 0 && u > bestU) {
        bestU = u;
        best = engine;
      }
    }
    map[ct] = best;
  }
  return map;
}

const avgWindow = (curve, from, to) => {
  const slice = curve.slice(from, to);
  const n = slice.length || 1;
  return {
    regret: slice.reduce((a, p) => a + p.regret, 0) / n,
    netSaved: slice.reduce((a, p) => a + p.netSaved, 0) / n,
  };
};

// ── Run ──────────────────────────────────────────────────────────────────────
const corpus = buildCorpus();
const staticSem = runStatic('semantic', corpus, 101);
const staticOpt = runStatic('optical', corpus, 303);
const { curve: adaptiveCurve, store } = runAdaptive(corpus, 202);
const optimal = optimalPolicy(corpus);
const learned = learnedMap(store);

const adaptEarly = avgWindow(adaptiveCurve, 0, 3);
const adaptLate = avgWindow(adaptiveCurve, ROUNDS - STEADY, ROUNDS);
const semLate = avgWindow(staticSem, ROUNDS - STEADY, ROUNDS);
const optLate = avgWindow(staticOpt, ROUNDS - STEADY, ROUNDS);

// ── Report ─────────────────────────────────────────────────────────────────
console.log('\n=== Arm G — cross-modal learning curve ===\n');
const sampleRounds = [1, 3, 6, 8, 12, 20, 40, 60].filter((r) => r <= ROUNDS);
console.log(
  mdTable(
    ['round', 'adaptive netSaved', 'adaptive regret'],
    sampleRounds.map((r) => {
      const a = adaptiveCurve[r - 1];
      return [String(r), pct(a.netSaved), a.regret.toFixed(3)];
    }),
  ),
);

console.log('\nSteady-state (last 15 rounds) — netSaved is the objective:');
console.log(
  mdTable(
    ['policy', 'netSaved', 'regret'],
    [
      ['static semantic-only', pct(semLate.netSaved), semLate.regret.toFixed(3)],
      ['static optical-only', pct(optLate.netSaved), optLate.regret.toFixed(3)],
      ['adaptive (learned)', pct(adaptLate.netSaved), adaptLate.regret.toFixed(3)],
      ['optimal (ceiling)', pct(optimal.netSaved), optimal.regret.toFixed(3)],
    ],
  ),
);

console.log('\nLearned routing vs offline-optimal:');
console.log(
  mdTable(
    ['content type', 'optimal', 'learned', 'match'],
    ['json', 'log', 'code', 'prose'].map((ct) => [
      ct,
      optimal.map[ct],
      learned[ct],
      optimal.map[ct] === learned[ct] ? '✓' : '✗',
    ]),
  ),
);

// ── Verdicts ───────────────────────────────────────────────────────────────
const learns = adaptLate.netSaved > adaptEarly.netSaved + 0.02;
const beatsBoth =
  adaptLate.netSaved > semLate.netSaved + 0.02 && adaptLate.netSaved > optLate.netSaved + 0.02;
// Pareto: no fixed single engine has BOTH higher netSaved AND lower-or-equal regret.
const dominatedBy = (b) => b.netSaved >= adaptLate.netSaved && b.regret <= adaptLate.regret;
const notDominated = !dominatedBy(semLate) && !dominatedBy(optLate);
const nearOptimal = adaptLate.netSaved >= 0.9 * optimal.netSaved;
const recovered = ['json', 'log', 'code', 'prose'].every((ct) => learned[ct] === optimal.map[ct]);

console.log('\n=== Verdicts ===');
console.log(`  learns (netSaved ↑ vs early):   ${learns ? 'PASS' : 'FAIL'} (${pct(adaptEarly.netSaved)} → ${pct(adaptLate.netSaved)})`);
console.log(`  beats BOTH single engines:      ${beatsBoth ? 'PASS' : 'FAIL'} (sem ${pct(semLate.netSaved)}, opt ${pct(optLate.netSaved)}, adaptive ${pct(adaptLate.netSaved)})`);
console.log(`  Pareto: not dominated by either: ${notDominated ? 'PASS' : 'FAIL'}`);
console.log(`  approaches optimal (≥90%):      ${nearOptimal ? 'PASS' : 'FAIL'} (${pct(adaptLate.netSaved)} vs ${pct(optimal.netSaved)})`);
console.log(`  recovered cross-modal map:      ${recovered ? 'PASS' : 'FAIL'}`);

const allPass = learns && beatsBoth && notDominated && nearOptimal && recovered;

// ── Persist ──────────────────────────────────────────────────────────────────
const resultsDir = join(here, 'results');
mkdirSync(resultsDir, { recursive: true });
const outPath = join(resultsDir, 'adaptive.json');
writeFileSync(
  outPath,
  JSON.stringify(
    {
      evidenceLevel: EVIDENCE.UNIT_SIMULATION,
      generatedAt: new Date().toISOString(),
      rounds: ROUNDS,
      warmup: WARMUP,
      staticSemCurve: staticSem,
      staticOptCurve: staticOpt,
      adaptiveCurve,
      optimal,
      learned,
      summary: { adaptEarly, adaptLate, semLate, optLate },
      verdict: { learns, beatsBoth, notDominated, nearOptimal, recovered, allPass },
      note: 'Regret from the simulated oracle. Replace with live retrieval events for validation.',
    },
    null,
    2,
  ),
);
console.log(`\nWrote ${outPath}`);
if (!allPass) process.exitCode = 1;
