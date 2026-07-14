# Reproducing Pixroom's benchmark claims

Pixroom separates deterministic offline checks from paid model evidence. Do not use an offline token estimate as proof of provider billing or model quality.

## No-key checks

These commands make no provider calls:

```bash
npm ci
npm run demo:qcv
npm run bench:qcv-quality
npm run bench:virtual
```

What they establish:

| Command | Evidence | What it can prove |
|---|---|---|
| `npm run demo:qcv` | Offline real transform | The shipped exact path can answer one supported lookup and replace its dataset region |
| `npm run bench:qcv-quality` | Offline real transform | Exact-operation and refusal coverage over the committed synthetic fixtures |
| `npm run bench:virtual` | Offline real transform | Token accounting for QCV against the committed comparison fixtures |

They do not establish live model quality, provider-reported usage, real-agent savings, or production latency.

## Independent paid pilot

Use a clean machine or disposable environment. Record the operator, date, OS, CPU, Node version, Python version, Pixroom commit, Headroom version, exact model ID, and Anthropic SDK/API version with the receipt.

Install the optional semantic sidecar used by the harness, then build Pixroom:

```bash
python3.13 -m venv .venv
.venv/bin/pip install "headroom-ai>=0.31.0"
export PIXROOM_HEADROOM_BIN="$PWD/.venv/bin/headroom"
npm ci
npm run build
npm run bench:anthropic:self-test
```

Set `ANTHROPIC_API_KEY` through your shell's secure or masked input flow. Never paste a key into an issue, command transcript, artifact, or pull request.

Run the free token-count preflight first:

```bash
BENCH_VIRTUAL_CONTEXT=1 \
BENCH_MODEL=claude-haiku-4-5-20251001 \
BENCH_ARTIFACT_LABEL=independent-macos-arm64-seed-202607 \
npm run bench:anthropic:preflight
```

Run the one-request canary. This requires an explicit paid-call switch and hard caps:

```bash
BENCH_ALLOW_PAID=1 \
BENCH_MAX_USD=0.01 \
BENCH_MAX_REQUESTS=1 \
BENCH_MODEL=claude-haiku-4-5-20251001 \
BENCH_ARTIFACT_LABEL=independent-macos-arm64-seed-202607 \
npm run bench:anthropic:canary
```

Only continue if the canary is exact and the preflight's projected maximum is acceptable:

```bash
BENCH_VIRTUAL_CONTEXT=1 \
BENCH_ALLOW_PAID=1 \
BENCH_MAX_USD=0.05 \
BENCH_MAX_REQUESTS=4 \
BENCH_SEED=202607 \
BENCH_MODEL=claude-haiku-4-5-20251001 \
BENCH_ARTIFACT_LABEL=independent-macos-arm64-seed-202607 \
npm run bench:anthropic
```

`BENCH_ARTIFACT_LABEL` preserves the canonical receipt and writes labeled JSON files under `benchmarks/results/`. Change both the seed and label for each repetition. Run at least five paired repetitions before treating the result as more than a pilot.

## Publishing a replication

1. Keep every successful and failed run.
2. Confirm the artifacts contain no credentials, proprietary prompts, or real user data. The harness refuses known Anthropic key shapes, but the operator still owns the review.
3. Open a benchmark-replication issue with environment metadata and the raw labeled JSON receipts, or submit a pull request that adds them without replacing the canonical pilot.
4. Report exact task counts, repetitions, model IDs, dates, provider usage, failures, retries, and exclusions beside every aggregate.
5. Do not update the README headline from a single replication. Aggregate reviewed runs first and preserve the original receipt.

The full generated [benchmark report](./REPORT.md) labels simulations, offline transforms, live controlled calls, and live agent runs separately.