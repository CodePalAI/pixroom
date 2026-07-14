// Arm B — live wrapped Copilot: baseline `copilot` vs `pixroom wrap copilot` on
// the same prompts, using the real GitHub Copilot subscription (no API key).
// Captures Copilot-reported tokens, the actual response, correctness, and latency.
// pxpipe is N/A here (no Copilot-subscription transport); pixroom == headroom
// (pixroom delegates copilot to the headroom backbone).

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { copilotSuite, parseTokens, stripAnsi, extractAnswer } from './lib.mjs';
import { EVIDENCE, liveEvidenceForKind } from './evidence.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

const REQUESTED_MODEL = process.env.BENCH_MODEL || 'claude-opus-4.8';
const FALLBACKS = ['claude-opus-4.1', 'claude-sonnet-4.5', 'gpt-4o'];
const CALL_TIMEOUT_MS = Number(process.env.BENCH_TIMEOUT_MS || 180000);

function runCmd(cmd, args, { cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, ms: Date.now() - start, timedOut });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + String(err), code: 127, ms: Date.now() - start, timedOut });
    });
  });
}

function looksLikeModelError(r) {
  const s = `${r.stdout}\n${r.stderr}`.toLowerCase();
  return /not supported|unknown model|invalid model|model_not_found|no such model|unsupported model/.test(s);
}

function baselineCmd(model, prompt) {
  return { cmd: 'copilot', args: ['--model', model, '-p', prompt] };
}
function wrappedCmd(model, prompt) {
  return {
    cmd: 'node',
    args: ['bin/cli.js', 'wrap', 'copilot', '--', '--model', model, '-p', prompt],
  };
}

async function probeModel() {
  const candidates = [REQUESTED_MODEL, ...FALLBACKS];
  for (const model of candidates) {
    const { cmd, args } = baselineCmd(model, 'Reply with exactly: PROBE_OK');
    const r = await runCmd(cmd, args, { cwd: repoRoot, env: process.env, timeoutMs: 90000 });
    if (!looksLikeModelError(r) && (r.code === 0 || /PROBE_OK/.test(stripAnsi(r.stdout)))) {
      return { model, fallback: model !== REQUESTED_MODEL, probe: r };
    }
  }
  return { model: REQUESTED_MODEL, fallback: false, probe: null, failed: true };
}

function summarize(r, check) {
  const clean = stripAnsi(`${r.stdout}\n${r.stderr}`);
  const tokens = parseTokens(clean);
  return {
    ok: !r.timedOut && r.code === 0,
    timedOut: r.timedOut,
    exitCode: r.code,
    ms: r.ms,
    tokensIn: tokens?.input ?? null,
    tokensOut: tokens?.output ?? null,
    correct: check(clean),
    snippet: extractAnswer(clean) || clean.replace(/\s+/g, ' ').trim().slice(0, 240),
  };
}

async function run() {
  const suite = copilotSuite(repoRoot);
  const wrappedEnv = { ...process.env, PIXROOM_LOG: 'warn' };

  console.log(`probing model '${REQUESTED_MODEL}'...`);
  const picked = await probeModel();
  const model = picked.model;
  console.log(`using model '${model}'${picked.fallback ? ` (fallback from ${REQUESTED_MODEL})` : ''}`);

  const results = {
    evidenceLevel: EVIDENCE.LIVE_AGENTIC,
    requestedModel: REQUESTED_MODEL,
    effectiveModel: model,
    modelFallback: picked.fallback,
    modelUnavailable: Boolean(picked.failed),
    generatedAt: new Date().toISOString(),
    runs: [],
  };

  for (const item of suite) {
    console.log(`\n[${item.id}] baseline...`);
    const bl = baselineCmd(model, item.prompt);
    const baseR = await runCmd(bl.cmd, bl.args, { cwd: repoRoot, env: process.env, timeoutMs: CALL_TIMEOUT_MS });
    const baseline = summarize(baseR, item.check);
    console.log(`  in=${baseline.tokensIn} out=${baseline.tokensOut} correct=${baseline.correct} ${baseline.ms}ms`);

    console.log(`[${item.id}] wrapped (pixroom→headroom)...`);
    const wr = wrappedCmd(model, item.prompt);
    const wrapR = await runCmd(wr.cmd, wr.args, { cwd: repoRoot, env: wrappedEnv, timeoutMs: CALL_TIMEOUT_MS });
    const wrapped = summarize(wrapR, item.check);
    console.log(`  in=${wrapped.tokensIn} out=${wrapped.tokensOut} correct=${wrapped.correct} ${wrapped.ms}ms`);

    results.runs.push({
      evidenceLevel: liveEvidenceForKind(item.kind),
      id: item.id,
      kind: item.kind,
      prompt: item.prompt,
      expected: item.expected,
      baseline,
      wrapped,
    });
  }

  mkdirSync(join(here, 'results'), { recursive: true });
  writeFileSync(join(here, 'results', 'copilot.json'), JSON.stringify(results, null, 2));
  console.log(`\ncopilot arm done — model=${model}, runs=${results.runs.length}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
