<div align="center"><pre>
██████╗ ██╗██╗  ██╗██████╗  ██████╗  ██████╗ ███╗   ███╗
██╔══██╗██║╚██╗██╔╝██╔══██╗██╔═══██╗██╔═══██╗████╗ ████║
██████╔╝██║ ╚███╔╝ ██████╔╝██║   ██║██║   ██║██╔████╔██║
██╔═══╝ ██║ ██╔██╗ ██╔══██╗██║   ██║██║   ██║██║╚██╔╝██║
██║     ██║██╔╝ ██╗██║  ██║╚██████╔╝╚██████╔╝██║ ╚═╝ ██║
╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚═╝     ╚═╝
       local-first agent I/O optimization runtime
</pre></div>

<p align="center"><strong>A programmable local runtime for inspecting and optimizing coding-agent input. pxpipe and headroom ship as the first two integrations behind a transactional kernel.</strong></p>

<p align="center">
  <img alt="license" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg">
  <img alt="built on" src="https://img.shields.io/badge/built%20on-pxpipe%20%2B%20headroom-6f42c1.svg">
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg">
       <img alt="tests" src="https://img.shields.io/badge/tests-passing-brightgreen.svg">
       <img alt="status" src="https://img.shields.io/badge/status-experimental-orange.svg">
</p>

<p align="center">
  <a href="#get-started-60-seconds">Install</a> ·
  <a href="#proof">Proof</a> ·
  <a href="#agent-compatibility">Agents</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="./benchmarks/REPORT.md">Benchmarks</a>
</p>

---

pixroom is evolving from a two-engine composition into an agent I/O optimization runtime. **[pxpipe](https://github.com/teamchong/pxpipe)** renders eligible cache-stable context to dense PNGs; **[headroom](https://github.com/headroomlabs-ai/headroom)** compresses eligible tool outputs and prose. Both now run as ordered integrations that return typed proposals; the host applies them atomically and rolls back failures.

The name is **pix** (pxpipe) + **room** (headroom).

## See it

```console
$ pixroom export planning/*.md            # offline — no LLM call

files: 3   input chars: 54245
stage      applied  reason      text → compressed   saved
optical    yes      applied     27121 → 3004        24117
──────────────────────────────────────────────────────────
TOTAL      27121 → 3004     saved 24117t (88.9%)     cache_control: owned
```

## What it does

- **Proxy** — `pixroom proxy`; point `ANTHROPIC_BASE_URL` / `OPENAI_BASE_URL` at it. Zero code changes, any language.
- **Agent wrap** — `pixroom wrap claude|codex|copilot|aider|opencode|goose|openhands|vibe` in one command (+ `cursor|cline|continue` print config). **Copilot uses your existing login — no API key.**
- **SDK** — `createPixroom().route(...)` — the embeddable Node/TS core.
- **Integration kernel** — `pixroom/kernel` exposes the registry, planner, proposal, and transaction contracts; `pixroom integration list` shows active integrations.
- **Protocol adapters** — Anthropic Messages, OpenAI Chat Completions, and OpenAI Responses (including Codex aliases) are registry-driven; unknown fields survive validation/encoding.
- **Output integrations** — normalized streaming text, tool-call, usage, stop, and error events; responses remain byte-for-byte passthrough unless an explicit future rewriter is enabled.
- **MCP server** — `pixroom mcp` → `pixroom_compress` · `_retrieve` · `_stats` for any MCP host.
- **Offline export** — `pixroom export <files>` — an honest, per-stage savings report with **no** LLM call.
- **Optical + semantic, composed** — images the static slab (pxpipe) *and* compresses tool outputs (headroom); one **CCR** store makes both reversible via an injected `headroom_retrieve` tool.
- **Honest & safe** — cache-aware measurement (negatives reported, never floored), **auth-mode stealth** on subscription traffic, and it **never fails closed** (sidecar down → optical-only; model unsupported → semantic-only).

## How it works

pixroom's router hands each region of a request to **exactly one** engine, so nothing is double-compressed, and unifies reversibility through one store:

| Region | Engine | Why |
|---|---|---|
| Static system + tool-docs slab | **optical** (pxpipe, in-process) | headroom won't mutate the cache hot-zone; pxpipe's strongest, safest win |
| Tool outputs · logs · JSON · code · history | **semantic** (headroom sidecar) | reversible, content-aware compressors + CCR |
| Recent turns · byte-exact IDs / secrets | **passthrough** | fidelity — never lossy-compressed |

```
 your agent / app   (Claude Code · Codex · Copilot · Cursor · your own code)
        │   Anthropic / OpenAI request   (your API key passes straight through)
        ▼
 ┌───────────────────────────────────────────────────────────────┐
 │  pixroom proxy    (Node/TS — owns transport · cache_control)   │
 │  ───────────────────────────────────────────────────────────  │
 │   1. semantic   tool outputs ─►  headroom /v1/compress         │
 │                 (loopback · keyless · never sees your keys)    │
 │   2. optical    static slab  ─►  pxpipe (in-process; pins the  │
 │                 single ttl:'1h' cache_control breakpoint)      │
 │   3. register both originals ─►  one CCR store (reversible)    │
 │   4. inject headroom_retrieve  ·  one honest savings report    │
 └───────────────────────────────────────────────────────────────┘
        │   compressed request   (single forward hop)
        ▼
 LLM provider   (Anthropic · OpenAI · …)  — responses stream back untouched
```

## Get started (60 seconds)

```bash
# 1 — Build  (pulls pxpipe-proxy — the optical engine, pure-JS, in-process)
npm install && npm run build && npm link        # gives you the `pixroom` command

# 2 — (optional) the semantic engine: a headroom sidecar
pip install headroom-ai                          # pixroom auto-spawns + health-checks it
#     absent? pixroom degrades to optical-only — it never fails closed.

# 3 — Use it
pixroom doctor                                   # health: toolchain · pxpipe · headroom
pixroom integration list                         # optimizer capabilities
pixroom agent list                               # honest traffic/delegate/config coverage
pixroom export README.md                         # offline savings report (no LLM)
pixroom wrap claude                              # wrap an agent in one command
pixroom proxy                                    # or run the proxy, point your agent at it
pixroom proxy --mode shadow --port 8788           # analyze proposals without mutation
```

Embed the core:

```ts
import { createPixroom } from 'pixroom';

const px = createPixroom();
const { report } = await px.route('anthropic', 'claude-fable-5', anthropicRequestBody);
console.log(report.tokensSavedTotal, report.savedFraction);   // honest, per-stage
```

## Current evidence

On five constructed, disjoint-region inputs, combining both transforms produces the sum of their token reductions. This is useful transform arithmetic, not a universal task-quality or latency claim. The benchmark uses real pxpipe/headroom transform code with synthetic agent-shaped payloads and one consistent token basis.

**Input-token savings vs raw** (real agent-shaped requests):

| workload | headroom-only | pxpipe-only | **pixroom** | vs best |
|---|---:|---:|---:|:--|
| JSON tool output + slab | 33% | 18% | **51%** | **strict win** |
| build log + slab | 20% | 18% | **38%** | **strict win** |
| source code + slab | 0%\* | 32% | **32%** | ties best |
| slab-heavy | 0% | 71% | **71%** | ties best |
| tools-heavy | 44% | 0% | **44%** | ties best |

<sub>Evidence level: `offline-real-transform`. `dominates-all = true` only within this five-scenario corpus. \*headroom's code compressor needs its `[code]` extra (not installed in this run).</sub>

**Why it works — additivity.** On the JSON workload, optical saved 3,353 tokens and semantic saved 6,125 — pixroom saved **exactly 9,478** (their sum). Neither engine alone captures both regions:

```
raw 18,661  ──optical(slab) −3,353──  ──semantic(tools) −6,125──►  pixroom 9,183   (−51%)
```

Reproduce: `node benchmarks/proof.mjs`. The full report separates simulation, offline transform, controlled live, and agentic live evidence in **[`benchmarks/REPORT.md`](./benchmarks/REPORT.md)**.

The adaptive controller remains an experimental mechanism test. Arm G uses hand-authored probabilities and ratios, and the same simulated oracle trains and grades it; it is not competitive product evidence. Real adaptation is gated on shadow proposals and held-out task benchmarks.

## Agent compatibility

`pixroom wrap <agent>` starts the right composition and launches the agent — ephemeral (env-only, no config files touched).

| Agent | How | Notes |
|---|---|---|
| **Claude Code** | proxy front door | optical + semantic — where pixroom shines (pxpipe-model traffic) |
| **Codex** · **Aider** · **OpenCode** · **Goose** · **OpenHands** · **Vibe** | proxy front door | base-URL env; semantic always, optical on supported models |
| **GitHub Copilot** | delegates to headroom | **subscription, no API key** — uses your existing login; `pixroom doctor copilot` checks readiness |
| **Cursor** · **Cline** · **Continue** | prints config | IDE extensions — paste the base URL it prints |

## Configuration

| Env | Purpose | Default |
|---|---|---|
| `PIXROOM_HOST` / `PIXROOM_PORT` | listen interface / port | `127.0.0.1` / `8788` |
| `PIXROOM_MODE` | `audit` (no processors), `shadow` (propose only), `optimize` (commit), `enforce` (reserved output policy) | `optimize` |
| `PIXROOM_MODELS` | optical model-scope CSV; `off` disables; unset = pxpipe default (Fable-5) | unset |
| `PIXROOM_OPTICAL` / `PIXROOM_SEMANTIC` | master switches | `on` |
| `PIXROOM_HEADROOM_URL` | headroom sidecar base URL | `http://127.0.0.1:8787` |
| `PIXROOM_HEADROOM_AUTOSPAWN` | auto-start `headroom proxy` if unreachable | `on` |
| `PIXROOM_SEMANTIC_PROSE` | also compress large prose in non-recent user turns (routes to headroom's Kompress) | `off` |
| `PIXROOM_OPTICAL_ON_SUBSCRIPTION` | allow lossy optical on oauth/subscription (stealth) | `off` |
| `PIXROOM_ADAPTIVE` | learn cross-modal routing from retrieval-regret (experimental) | `off` |
| `PIXROOM_ADAPTIVE_LOG` | observe-only: record the regret signal without changing routing | `off` |
| `PIXROOM_ADAPTIVE_STORE` | path to persist the learned policy (empty = in-memory) | unset |
| `PIXROOM_LOG` | `silent`\|`error`\|`warn`\|`info`\|`debug` | `info` |

<details>
<summary><b>Enabling optical for opus 4.8 (or any model)</b></summary>

Optical imaging is opt-in **per model** because dense renders are lossy and some models read them poorly. To add opus 4.8, list it in `PIXROOM_MODELS` — the list *replaces* the default, so include Fable-5 too:

```bash
PIXROOM_MODELS=claude-fable-5,claude-opus-4-8 pixroom proxy
```

Measured on live opus 4.8: pxpipe's **factsheet keeps fragile identifiers (hex, UUIDs, numbers, paths) as text** (verified byte-exact), so only the prose bulk is imaged. But opus is a weaker image reader than Fable-5, and on a subscription this is additionally gated by `PIXROOM_OPTICAL_ON_SUBSCRIPTION=1` and can bust Claude Code's prompt cache — so it stays **off by default**. Prefer it on PAYG/API traffic. Details in [`benchmarks/REPORT.md`](./benchmarks/REPORT.md).

</details>

<details>
<summary><b>Compressing user prose (<code>PIXROOM_SEMANTIC_PROSE</code>)</b></summary>

By default the semantic stage hands headroom only the **`tool_result`** region. Large plain-text prose in **user** turns (pasted docs, long RAG context) otherwise passes through raw. Set `PIXROOM_SEMANTIC_PROSE=1` to also route those blocks to headroom's content-aware compressors — **Kompress** (ModernBERT prose token-drop) for prose, SmartCrusher for structured text. pixroom sends `compress_user_messages` to the sidecar automatically, so the prose path works regardless of the sidecar's savings profile.

```bash
PIXROOM_SEMANTIC_PROSE=1 pixroom proxy
```

Kompress runs on a lightweight ONNX path — the sidecar only needs its tokenizer (`pip install transformers`; `onnxruntime` is already a headroom core dep, **no torch required**). The model auto-downloads on first use. Measured savings are **~6–21% of prose tokens** depending on redundancy (dense prose compresses least, verbose/redundant prose most). Without the tokenizer the sidecar simply no-ops prose — pixroom degrades safely.

It's **off by default** because user prose is instruction content, not machine output: only **non-recent** user turns above `PIXROOM_SEMANTIC_PROSE_MIN_CHARS` (default `800`) are touched, the last `protectRecent` turns and all model output stay byte-exact, and any offloaded text is recoverable through the same `headroom_retrieve` tool as the rest of the CCR store. This composes headroom's existing ML prose compressor rather than adding a redundant engine (headroom itself retired its standalone LLMLingua-2 path in favor of Kompress).

</details>

<details>
<summary><b>Adaptive cross-modal routing (<code>PIXROOM_ADAPTIVE</code>, experimental)</b></summary>

pixroom records **retrieval-regret** — how often the model pulls an offloaded original back — with integration attribution. The current controller explores how that signal might inform later proposal selection.

Set `PIXROOM_ADAPTIVE=1` to enable the controller. Per region it maximizes expected **net token saving** — `saved − regret` (a retrieval wastes the compressed copy) — from a persistent per-(content-type × engine) posterior. Guarantees:

- **Cold-start = today.** With no evidence it reproduces the static routing exactly.
- **Cache-safe.** Decisions are stable within a session and adapt only *across* sessions, so routing never flips per request and busts the prompt cache.
- **Bounded harm.** A non-default engine only wins once it clears an evidence bar; on any error the router falls back to the static path (never fails closed).

`PIXROOM_ADAPTIVE_LOG=1` is the safe first step: it records the regret signal (and persists it to `PIXROOM_ADAPTIVE_STORE`) **without changing any routing** — gather evidence, inspect it, then enable the controller.

**Honest scope.** `benchmarks/rd_frontier.mjs` and `benchmarks/adaptive.mjs` are `unit-simulation` artifacts. Their oracle probabilities and engine ratios are hand-authored, so they validate controller plumbing only. The current slab decision also chooses between optical and raw passthrough, not two transforms over the same region. The feature stays off by default until real shadow-mode proposals and held-out task evidence exist.

</details>

## Compose, don't fork

pixroom consumes both upstreams as **pinned, unmodified dependencies** — `pxpipe-proxy` (npm, in-process) and `headroom-ai` (a managed loopback sidecar). It owns only the glue: the router, one CCR store, one measurement layer, one front door. Upgrades are version bumps gated by smoke tests, not re-ports — so pixroom keeps inheriting both projects' daily improvements. See [`UPSTREAM.md`](./UPSTREAM.md).

## Develop

```bash
npm run typecheck
npm test                        # unit + real pxpipe optical + fake-sidecar end-to-end
node benchmarks/proof.mjs       # constructed additivity check
node benchmarks/rd_frontier.mjs # simulated RD surface
node benchmarks/adaptive.mjs    # controller simulation
npm run bench:profile           # paired direct-vs-proxy local profile + raw samples
```

## Status

**Experimental kernel migration underway.** The current proxy/CLI/MCP surfaces remain compatible, while pxpipe and headroom now run behind a public integration registry and atomic transaction boundary. Next are protocol adapters (starting with OpenAI Responses), shadow mode, capture/replay, and the quality-constrained benchmark v2.

## License

**Apache-2.0.** Bundles attribution for pxpipe (MIT) and headroom (Apache-2.0) — see [`NOTICE`](./NOTICE).

