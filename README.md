<h1 align="center">Pinpoint</h1>

<p align="center"><strong>The policy gateway for sensitive MCP data.</strong></p>

<p align="center">Let AI agents act on structured business data without placing selected values in model context.</p>

<p align="center"><sub>Move exact data between MCP tools without putting the values in model context.</sub></p>

<p align="center">
  <a href="LICENSE"><img alt="Apache 2.0 license" src="https://img.shields.io/badge/license-Apache%202.0-1f6feb.svg"></a>
  <a href="https://github.com/CodePalAI/pinpoint/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/CodePalAI/pinpoint/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Node.js 22 or newer" src="https://img.shields.io/badge/node-%E2%89%A522-2f855a.svg">
  <a href="./benchmarks/results/mcp-opaque-flow-cross-host.first-party-macos-arm64-20260715.json"><img alt="Opaque flow gate passed on two clients for one synthetic flow" src="https://img.shields.io/badge/opaque%20flow%20gate-2%20clients%20%2F%201%20synthetic%20flow-2ea44f.svg"></a>
  <img alt="Experimental status" src="https://img.shields.io/badge/status-experimental-c2410c.svg">
</p>

<p align="center">
  <a href="#the-business-problem">Business case</a> ·
  <a href="#who-it-is-for">Who it is for</a> ·
  <a href="#evidence">Evidence</a> ·
  <a href="#get-started-60-seconds">Evaluate</a> ·
  <a href="#security-boundary">Security</a> ·
  <a href="./planning/value_opaque_mcp_dataflow.md">Technical brief</a>
</p>

<p align="center"><sub>Open source · Local or VPC-side · MCP-layer control · Host keeps its provider, model, and login</sub></p>

<p align="center"><sub><strong>AI agents / LLMs:</strong> read <a href="./llms.txt"><code>/llms.txt</code></a> for the compact project index.</sub></p>

<p align="center">
  <img src="./assets/pinpoint-policy-flow.svg" alt="Pinpoint controls an exact local projection from an existing source MCP tool into an existing destination MCP tool while the AI agent receives only a random capability and signed receipt" width="1100">
</p>

---

## The business problem

Your AI agent needs customer records from a warehouse and must create approved records in a CRM. In a conventional MCP loop, the source response becomes a tool result in the agent conversation and typically becomes input to the next model turn, even when only the destination tool needs the values.

That creates four problems for an enterprise team:

| Risk | What the organization inherits |
|---|---|
| **Tool values enter the agent conversation** | A full CRM, database, or analytics result can become model input even when the next tool is its only consumer |
| **Prompt-based control** | A system prompt asks the model to follow data-handling rules that should be enforced in code |
| **Weak execution evidence** | A tool log may show that a destination ran without binding the event to a policy shape, source, projected fields, item bound, and receipt chain |
| **Context growth and copy errors** | Large payloads consume context and the model may reproduce or transform values incorrectly |

Pinpoint moves that control into the MCP gateway. The operator declares which source may feed which destination, which fields may move, which filters may run, and the maximum payload size. Pinpoint executes the exact projection locally, invokes the destination tool internally, and returns a signed receipt instead of the values.

> **The model chooses an approved flow. The operator defines its authority.**

## What it does

Pinpoint has two operating modes in one gateway:

## What changes at the tool boundary

| Mode | Use it when | Model receives | Failure posture |
|---|---|---|---|
| **Value-opaque flow** | One tool needs exact values from another tool, but the model does not | Random capability, policy metadata, signed receipt | Protected sources fail closed |
| **Exact result firewall** | A tool returns large JSON, logs, traces, or documents that the agent may need to inspect | Compact artifact plus bounded exact query access | Unsupported optimization passes through |

The lossless MCP result firewall for AI agents remains part of the product. The primary enterprise control is now policy-bound, value-opaque dataflow.

## Who it is for

| Owner | The decision Pinpoint helps them make | What they can measure |
|---|---|---|
| **CISO / Security Director** | Which MCP data paths may execute without exposing selected values to the model | Client-visible canary occurrence, blocked bypasses, policy coverage |
| **CTO / VP Engineering** | How to add a reusable control point without rewriting every host and tool | Integration time, supported hosts, gateway error rate |
| **Head of AI / AI Platform Director** | How to keep agent workflows exact while reducing context and model-mediated copying | Task success, visible bytes, extra turns, latency |
| **Data Governance / Compliance Engineering** | How to retain machine-verifiable evidence of field-level movement | Signed receipts, policy hashes, destinations, item and byte bounds |
| **MCP / API Platform Team** | How to normalize behavior across Claude Code, Copilot, and other MCP hosts | Cross-host conformance, source coverage, pass-through reasons |

Pinpoint is most relevant when your team owns the MCP deployment boundary and handles structured business data, logs, traces, documents, or API results that may be too sensitive or too large to route through a model.

## Where it earns its keep

| Workflow | Source | Local policy action | Hidden destination |
|---|---|---|---|
| Customer operations | Account or support records | Filter eligibility; project approved contact fields | CRM, campaign, or case-management tool |
| Security operations | Alerts, logs, or asset inventory | Select severity, identifiers, and bounded evidence | Incident or ticketing tool |
| Finance operations | Transactions or invoices | Select approved records and required reconciliation fields | ERP or reconciliation tool |
| Data platform | Warehouse or analytics result | Apply exact filters and field projection | Internal API or workflow tool |
| Developer platform | Large MCP result | Keep exact data local; expose bounded query operations | Agent context only when requested |

Pinpoint does not make these systems compliant by itself. It gives security and platform teams a concrete enforcement point and an auditable execution record to evaluate inside their own control framework.

## Evidence

The committed evidence uses deterministic synthetic fixtures and real installed clients. Raw event streams are graded and deleted; content-free receipts remain in the repository.

| Gate | Result | Scope |
|---|---:|---|
| Cross-host value-opaque flow | **2/2 test clients passed** | One first-party synthetic 40-record flow on Claude Code and GitHub Copilot CLI |
| Client event-stream scan | **0 / 800 canary occurrences** | Exact string checks across the two retained synthetic client grades |
| Hidden destination control | **0 model destination calls** | The gateway invoked the destination in those two traces |
| Protocol integration | **30 / 30 correct destination invocations** | One deterministic local stdio fixture and policy |
| Adversarial protocol gate | **7 / 7 bypasses denied** | Direct query, resource read, destination call, forbidden field, operation switch, forged capability, fixed-argument override |
| Constructed visible traffic | **31,013 -> 2,628 bytes** | Same synthetic source and destination payload; character bytes, not provider tokens or bill |
| Local flow latency | **0.91 ms p95** | 30 local protocol samples on the recorded machine; not a production load test |

Read the [cross-host receipt](./benchmarks/results/mcp-opaque-flow-cross-host.first-party-macos-arm64-20260715.json), [protocol receipt](./benchmarks/results/mcp-opaque-flow.first-party-macos-arm64-20260715.json), or [full evidence methodology](./benchmarks/REPORT.md).

**Evidence boundary:** these are first-party synthetic tests, not customer production traces, a formal noninterference proof, a prevalence estimate, or a compliance certification. Tool names, field names, counts, byte sizes, timing, and success status remain observable. The wrapped MCP process is trusted with the values.

## Why this is different

| Approach | Where values may exist | Who defines the operation | Pinpoint's distinction |
|---|---|---|---|
| Prompt instructions | Model context | Model or prompt author | Pinpoint enforces a versioned operator policy in code |
| Redaction / tokenization | Model sees transformed values | Gateway rules | Pinpoint can execute an exact stored-result projection into a destination tool |
| Generated code / code mode | Execution sandbox | Model-generated program | Pinpoint uses a fixed declarative operation set; no generated code or sandbox is required |
| Agent information-flow control | Instrumented planner and labels | Planner policy | Pinpoint wraps unmodified stdio MCP tools and emits signed execution receipts |

Anthropic, Cloudflare, Microsoft Fides, NetworkNT, LeanCTX, Proof-Carrying Agent Actions, and enclawed establish important parts of this problem. Pinpoint's narrower contribution is the integrated MCP mechanism: transparent wrapping, fail-closed source capture, exact policy-bound projection, hidden destination invocation, and signed commitment-only receipts. The [prior-art analysis](./planning/value_opaque_mcp_dataflow.md#prior-art-and-novelty-boundary) states the claim conservatively.

## Get started (60 seconds)

You need Node.js 22 or newer and Git. Until the npm package is publicly verified, build the CLI from the repository:

```bash
git clone https://github.com/CodePalAI/pinpoint.git
cd pinpoint
npm install && npm link
```

Run the committed no-model protocol gate before connecting a host:

```bash
npm run bench:mcp-opaque-flow
```

It executes 30 exact hidden-destination calls, seven blocked bypass attempts, receipt verification, transcript canary scanning, and local latency measurement against a synthetic stdio MCP fixture.

Run an existing stdio MCP server behind Pinpoint:

```bash
pinpoint mcp gateway \
  --flow-config ./examples/mcp-opaque-flow.json \
  -- npx -y <your-mcp-server-package>
```

<!-- LAUNCH(npm): Replace the checkout flow above with verified npm commands only after the registry confirms the package. -->

Put that command where your host currently launches the upstream server:

```json
{
  "mcpServers": {
    "controlled-api": {
      "command": "pinpoint",
      "args": [
        "mcp", "gateway",
        "--flow-config", "./flow-policy.json",
        "--",
        "npx", "-y", "<your-mcp-server-package>"
      ]
    }
  }
}
```

Start with the [policy example](./examples/mcp-opaque-flow.json) and [JSON Schema](./examples/mcp-opaque-flow.schema.json). Runtime validation remains authoritative.

## Value-opaque flows

A flow policy binds one source to one destination and limits every degree of freedom the model may request:

```json
{
  "version": 1,
  "flows": [{
    "name": "deliver_active_accounts",
    "sourceTool": "accounts_list",
    "sourceKind": "json-array",
    "destinationTool": "campaign_deliver",
    "destinationArgument": "recipients",
    "fixedDestinationArguments": { "campaign": "renewal" },
    "allowedOps": ["json_select"],
    "allowedWhereFields": ["active"],
    "allowedFields": ["email"],
    "maxItems": 100,
    "maxBytes": 16384
  }]
}
```

With this policy loaded:

1. `accounts_list` is a protected source at every result size.
2. Pinpoint returns a random process-local capability instead of the rows.
3. The model may request only `active` filtering and `email` projection.
4. Pinpoint calls `campaign_deliver` internally with the exact selected values.
5. The model receives a signed receipt containing policy facts, bounds, commitments, and success status, but not the values.

The client receives a receipt shaped like this:

```json
{
  "flow": "deliver_active_accounts",
  "sourceTool": "accounts_list",
  "destinationTool": "campaign_deliver",
  "whereFields": ["active"],
  "projectionFields": ["email"],
  "items": 42,
  "destinationSucceeded": true,
  "policyShapeSha256": "...",
  "receiptHash": "...",
  "signature": "..."
}
```

The session verification key is pinned in the MCP `initialize` response. SDK users should call `verifyMcpOpaqueFlowReceipt(receipt, initializedVerifier)` so a valid receipt from another session is rejected.

Pinpoint returns the receipt through MCP but does not persist it. If your audit policy requires durable retention, the host or an existing collector must store the value-free receipt. Do not enable body capture merely to retain receipts; body capture can persist sensitive prompts and tool values.

Do not put provider credentials in `fixedDestinationArguments`; the policy is a plaintext operator file. Keep authentication in the upstream server's existing credential mechanism.

## Evaluate with your team

Pinpoint is designed for a joint platform and security evaluation, not a blind production install.

| Step | Owner | Decision artifact |
|---|---|---|
| Select one bounded workflow | AI platform or MCP team | Source tool, destination tool, required fields, maximum records |
| Encode authority | Security engineering | Reviewed flow policy with fixed and allowlisted arguments |
| Run the local fixture and your own synthetic data | Platform engineering | Protocol receipt, client event scan, latency and failure report |
| Review the trust boundary | Security, data governance, application owner | Accepted upstream-process, metadata, storage, and network assumptions |
| Run a controlled workload | Application owner | Task success, blocked bypasses, model-visible bytes, operational errors |
| Decide whether to retain the gateway | CTO, CISO, or delegated owner | Deployment scope, owner, rollback path, and independent review plan |

Suggested acceptance criteria for a first evaluation:

- the destination receives the exact approved projection;
- prohibited fields never appear in the client event stream;
- direct destination and alternate artifact access are denied;
- every completed flow has a receipt bound to the initialized session key;
- gateway failure behavior matches the application's availability and confidentiality requirements;
- the team accepts every residual metadata and upstream-process trust boundary documented below.

Use [GitHub Discussions](https://github.com/CodePalAI/pinpoint/discussions) for architecture questions and sanitized field reports. Report security issues through the private process in [SECURITY.md](./SECURITY.md).

## Deployment fit

| Decision | Current answer |
|---|---|
| **Best fit** | Local or VPC-side wrapper around an existing stdio MCP server |
| **Host changes** | None beyond replacing the MCP launch command |
| **Tool changes** | None for the wrapped source and destination tools |
| **Model / provider changes** | None; the MCP host keeps its existing model and login |
| **Policy owner** | Your operator, platform, or security team; never the model |
| **Runtime storage** | Bounded process memory; artifacts disappear at shutdown |
| **Validated hosts** | Claude Code and GitHub Copilot CLI on committed synthetic gates |
| **Not yet supported** | Cross-server flows with separate auth domains, durable operator identity keys, remote attestation, or formal compliance claims |
| **Maturity** | Experimental; suitable for controlled evaluation and contribution, not an automatic enterprise approval |

## Security boundary

| Pinpoint is designed to control | Pinpoint does not provide |
|---|---|
| Selected source and destination values on the client-facing MCP path | Isolation from a malicious or compromised wrapped MCP process |
| Operator-declared source, destination, operation, fields, arguments, and limits | Protection from the upstream process's own network, files, subprocesses, or timing channels |
| Direct query, resource, hidden-destination, capability, and argument bypasses covered by the committed protocol gate | Secrecy for tool names, field names, operation, counts, sizes, limits, timing, or success status |
| Receipt integrity under the session key pinned during MCP initialization | Durable operator identity, approval provenance, remote attestation, or cross-restart receipt continuity |
| Bounded process-local artifact retention | A DLP suite, identity provider, zero-retention guarantee, or compliance certification |

The trusted computing base includes Pinpoint, the reviewed flow policy, the wrapped MCP process, and the operating-system boundary. Read [SECURITY.md](./SECURITY.md) and the [full threat model](./planning/value_opaque_mcp_dataflow.md#threat-model) before a controlled deployment.

## Works with your stack

| Surface | Integration | Current evidence |
|---|---|---|
| Any stdio MCP host | `pinpoint mcp gateway --flow-config <policy> -- <server>` | Protocol integration suite |
| Claude Code MCP | Replace the configured server command | Live synthetic flow passed |
| GitHub Copilot CLI | Replace the configured server command | Live synthetic flow passed; zero premium requests in the committed run |
| VS Code, Codex, Cursor, other MCP hosts | Same stdio wrapper pattern | Protocol-compatible; independent host replication remains open |
| Node.js applications | Import `@codepal/pinpoint/mcp` | Packed consumer type and runtime smoke |

Pinpoint does not require a new Provider API key. **Subscription-compatible at the MCP layer:** the host keeps its current model, API key, OAuth, or subscription login. The older provider-wire optimizer has separate API-key-only rules documented in the technical appendix.

<details>
<summary><strong>Developer integrations and secondary optimization engine</strong></summary>

<br>

## Choose your path

No new provider account. No model migration. Pick the integration surface you already use:

| Your large data enters through... | Start here | What stays unchanged |
|---|---|---|
| An MCP server | `pinpoint mcp gateway -- <server> [args...]` | Host, upstream tool names, arguments, provider, and login |
| Anthropic or OpenAI TypeScript SDK | `withPinpoint(client)` | Native client methods, return types, streams, and retries |
| Provider HTTP | `pinpoint proxy` | Client and provider protocol |
| A local fixture | `pinpoint demo` | No key, model call, sidecar, or network needed |

### MCP gateway: the main path

Wrap the command your host already uses to launch an MCP server:

```bash
pinpoint mcp gateway -- npx -y <server-package>
pinpoint mcp gateway --min-chars 32000 -- python -m your_mcp_server
```

`--min-chars` overrides the default 16,000-character virtualization threshold. `PINPOINT_MCP_MIN_CHARS` provides the same setting for managed environments.

The host sees all upstream tools plus `pinpoint_query`. When an eligible result crosses the threshold:

1. Pinpoint retains the exact text or structured object in bounded process memory.
2. The original call returns a compact text manifest and `pinpoint://artifact/<id>` resource link.
3. The agent calls `pinpoint_query` for a bounded exact result.
4. The full artifact never enters model context unless the gateway deliberately passes it through.

This moves Pinpoint ahead of host truncation. It also makes the exact path available on subscription/OAuth clients because no model API request is intercepted.

The original `pinpoint mcp` command still starts Pinpoint's standalone compress/retrieve/stats server. The gateway is selected only by the explicit `mcp gateway -- ...` form.

### TypeScript SDK: native client in, native response out

Until Pinpoint is on npm, build a checkout and install that local directory in your app:

```bash
git clone https://github.com/CodePalAI/pinpoint.git
cd pinpoint && npm install && npm run build
cd /path/to/your-app && npm install /path/to/pinpoint
```

<!-- LAUNCH(npm): Replace the checkout flow above with `npm install @codepal/pinpoint` after registry verification. -->

Pinpoint is ESM-only. TypeScript projects should use `"module": "NodeNext"` and `"moduleResolution": "NodeNext"`; JavaScript projects should set `"type": "module"` or use `.mjs` files. Requests made with your provider API key can use the exact-data path.

Wrap an Anthropic client:

```ts
import Anthropic from '@anthropic-ai/sdk';
import { withPinpoint } from '@codepal/pinpoint/anthropic';

const anthropic = await withPinpoint(new Anthropic());

try {
  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'Find the failed account in this tool output...' }],
  });

  console.log(message.content);
  console.log(anthropic.pinpoint.stats());
} finally {
  await anthropic.pinpoint.close();
}
```

Or wrap an OpenAI client. Both Chat Completions and Responses use Pinpoint:

```ts
import OpenAI from 'openai';
import { withPinpoint } from '@codepal/pinpoint/openai';

const openai = await withPinpoint(new OpenAI());

try {
  const response = await openai.responses.create({
    model: 'gpt-4.1-mini',
    input: 'Find the failed account in this tool output...',
  });

  console.log(response.output_text);
  console.log(openai.pinpoint.stats());
} finally {
  await openai.pinpoint.close();
}
```

`withPinpoint()` starts an ephemeral loopback proxy and points that client at it. The official SDK still owns response parsing and streaming, so its native return types and stream APIs stay intact. `close()` stops Pinpoint and restores the client's original `baseURL`. Provider keys remain configured on the original client and are never written to disk.

### Any language or HTTP client: change the base URL

Start Pinpoint:

```bash
pinpoint proxy
```

Then point your existing client at it:

```bash
# Anthropic-compatible clients
ANTHROPIC_BASE_URL=http://127.0.0.1:8788 your-command

# OpenAI-compatible clients
OPENAI_BASE_URL=http://127.0.0.1:8788/v1 your-command
```

Keep your normal provider key configured in the client. Pinpoint forwards it to the same provider and does not write it to disk. Anthropic Messages, OpenAI Chat Completions, and OpenAI Responses are supported.

## What passes through

The MCP gateway virtualizes a result only when every safety condition holds:

1. The upstream call succeeded and returned either one text block or a structured JSON object.
2. The exact payload meets the 16,000-character default threshold.
3. The compact artifact envelope is smaller than the original result.
4. Bounded local storage can retain the complete payload atomically.
5. Structured data has an exact query shape. A nested record array is selected only when it is the sole candidate within three wrapper levels.

Everything else passes through unchanged. That includes error results, images and other media, mixed content blocks, small responses, multiple competing nested arrays, unsupported values, and results that cannot fit in the local store.

Those are the ordinary **optimization** rules. A source named in an opaque-flow policy is a **confidentiality** boundary instead: Pinpoint captures it regardless of size or envelope profitability and returns a value-free error if exact capture fails. Protected result metadata, extension fields, JSON-RPC errors, stderr, and unsolicited server messages cannot act as alternate value paths. This intentional fail-closed behavior applies only when the operator loads a flow policy.

Artifacts live only for the gateway process lifetime. The default store is capped at 256 entries and 64 MiB with least-recently-used eviction. Query outputs are capped independently; clients cannot use `pinpoint_query` to dump an unbounded artifact back into context.

### Provider-wire QCV: the secondary path

The Anthropic/OpenAI proxy still targets large **older tool results** already present in a provider request. On API-key traffic it can precompute an exact current-question answer before the request leaves the machine:

| Current question | Local operation | Provider receives |
|---|---|---|
| "What is the email for ID 73?" | Exact JSON lookup | The matching value, not the whole array |
| "How many records have `active: true`?" | Exact filtered count | The exact number |
| "Which customer owns order 981?" | One-hop unique-key join | The bounded joined projection |
| "How many ERROR lines are there?" | Boundary-aware log count | The exact count |
| A range, duplicate key, competing dataset, or unclear question | Refuse to guess | The original tool result, unchanged |

Provider-wire QCV remains useful for custom applications and clients that already send full historical results. It is not the main coding-CLI thesis because modern hosts often filter or truncate the data before the model API boundary.

<details>
<summary><strong>How this differs from summarization, prompt caching, and compaction</strong></summary>

<br>

Summaries are useful when the model needs the gist. They are a poor primitive for exact IDs, counts, paths, and rows. Pinpoint's exact path retains the original locally and computes only supported deterministic operations.

| Technique | Primary job | Relationship to Pinpoint |
|---|---|---|
| MCP server filtering and pagination | Prevents oversized results at the source | Preferred when the server can be changed; Pinpoint protects unmodified servers |
| Host spill-to-file | Retains output behind a local path | Host-specific and usually text-oriented; Pinpoint adds protocol-native resources and exact structured operations |
| Provider prompt caching | Discounts repeated byte-identical prefixes | Still useful after the gateway reduces what enters history |
| Provider compaction | Summarizes or clears older history | Acts later and may lose exact details; Pinpoint retains queryable bytes before history |
| Text or image compression | Reduces general prose, code, or static context | Optional [Headroom](https://github.com/headroomlabs-ai/headroom) and [pxpipe](https://github.com/teamchong/pxpipe) integrations remain secondary modules |

Pinpoint composes with these techniques; it does not claim to replace them.

</details>

## How it works

A normal MCP host calls a tool, receives its result, and inserts that result into the next model turn. At that point the provider bill and context damage are already determined.

The gateway moves the decision one boundary earlier:

1. It starts the unmodified upstream stdio server and forwards JSON-RPC requests, responses, notifications, and server-initiated messages.
2. It preserves upstream tool names and input schemas. Structured output schemas become an explicit union of the original object and Pinpoint's artifact envelope.
3. Eligible oversized results enter the local virtual store before the host receives them.
4. The host receives a small manifest, a `resource_link`, and the `pinpoint_query` tool.
5. Exact bounded query results enter model context only when requested.

```
MCP host / coding agent
  |
  | tools/call
  v
Pinpoint MCP gateway -----> unmodified upstream MCP server
  |                              |
  | exact local artifact <-------+
  |
  +---- compact resource handle ----> host conversation
  +<--- pinpoint_query ---------------+
  +---- bounded exact result --------> model
```

The model provider is not in this data path until after the gateway has reduced the result. MCP server credentials remain in the upstream command environment; Pinpoint does not persist them.

### Exact answers instead of summaries

Suppose an MCP API returns 1,000 accounts even though the agent needs one email. Pinpoint returns the artifact schema and identifier. The agent then calls:

```json
{
  "id": "vctx_...",
  "op": "json_select",
  "where": { "accountId": 733 },
  "fields": ["email"]
}
```

The query engine returns one exact projection. It does not summarize the array, use embeddings, or ask a second model to copy a row.

<details>
<summary><strong>When exact optimization applies</strong></summary>

Provider-wire QCV changes an Anthropic/OpenAI request only when all of these checks pass:

1. The request uses Anthropic Messages, OpenAI Chat, or OpenAI Responses with a provider API key.
2. One older tool result meets the size and content rules and matches one explicit lookup or supported count.
3. The local operation returns one complete, bounded, unambiguous result.
4. The dataset reference plus exact result is smaller than the original tool output.
5. The data fits the configured request and memory limits.

Repeated selectors, ranges, negation, multiple matching datasets, malformed values, and subscription traffic pass through unchanged. Exact prefetch works with streaming responses.

</details>

An experimental model-planned fallback exists for harder Anthropic questions, but it is off by default because an earlier version saved tokens while reducing task quality. Disable provider-wire QCV with `PINPOINT_VIRTUAL_CONTEXT=0` or `pinpoint proxy --no-qcv`. The MCP gateway is separately and explicitly activated by `pinpoint mcp gateway`. The [technical design note](./planning/query_backed_context.md) documents the shared exact query engine and rejected fallback design.

## Advanced workflows

Most MCP users only need `pinpoint mcp gateway -- <server>`. The commands below are for provider-wire evaluation and integration work.

<details>
<summary><strong>Show capture, telemetry, library, and MCP workflows</strong></summary>

<br>

### Preview changes without applying them

```bash
pinpoint proxy --mode shadow --port 8788
```

### Capture and replay your own traffic

Capture bodies only on a trusted machine. Pinpoint records metadata by default and includes prompts only when you explicitly enable them:

```bash
PINPOINT_CAPTURE_PATH=.pinpoint/capture.jsonl PINPOINT_CAPTURE_BODIES=1 pinpoint proxy
pinpoint replay .pinpoint/capture.jsonl
```

Replay runs the captured requests through the current Pinpoint rules without calling a provider.

### Export telemetry

Send content-free optimization events to an OpenTelemetry-compatible OTLP/HTTP collector:

```bash
PINPOINT_OTLP_ENDPOINT=http://127.0.0.1:4318/v1/traces pinpoint proxy
```

### Transform request bodies directly

```ts
import { createPinpoint } from '@codepal/pinpoint';

const pinpoint = createPinpoint();
const { body, report } = await pinpoint.route(
  'anthropic',
  'claude-haiku-4-5',
  anthropicRequestBody,
);

console.log(body);
console.log(report.tokensSavedTotal, report.savedFraction);
await pinpoint.shutdown();
```

Other useful commands:

```bash
pinpoint stats               # savings from a running proxy
pinpoint export README.md    # offline transform report
pinpoint integration list    # installed compression and policy modules
pinpoint mcp                 # MCP tools over stdio
```

Provider wrappers are exported from `@codepal/pinpoint/anthropic` and `@codepal/pinpoint/openai`. `@codepal/pinpoint/mcp` exports the gateway and firewall APIs. Other public subpaths expose the integration kernel, protocols, normalized output events, agent adapters, virtual-context APIs, capture/replay, and OTLP telemetry.

</details>

<br>

</details>

<details>
<summary><strong>Full benchmark archive and historical optimizer evidence</strong></summary>

<br>

## Proof

CodePal publishes Pinpoint's raw benchmark artifacts, negative results, and safety checks so people can inspect the claims rather than trust a headline.

### Cross-host value-opaque flow gate

Claude Code 2.1.197 with Claude Haiku 4.5 and GitHub Copilot CLI 1.0.71-2 with GPT-5.3 Codex independently executed the same authorized synthetic flow through the production CLI gateway. Each host called only `synthetic_accounts_list` and `pinpoint_flow`. Neither model called the hidden `synthetic_projection_validate` destination or `pinpoint_query`.

| Host | Source call | Opaque flow | Model destination call | Signed receipt | Exact destination acceptance | Final answer |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Claude Code | Yes | Yes | No | Valid | 40 records | `VALIDATED` |
| GitHub Copilot CLI | Yes | Yes | No | Valid | 40 records | `VALIDATED` |

The grader scanned 400 synthetic private canaries per host, 800 total, and found zero occurrences in either client event stream. It also found neither public source nor selected-payload hashes. Claude completed in nine turns for $0.045451 observed provider cost. Copilot reported zero premium requests and zero file changes. Inspect the [content-free cross-host receipt](./benchmarks/results/mcp-opaque-flow-cross-host.first-party-macos-arm64-20260715.json) or rerun `npm run bench:mcp-opaque-flow:cross-host` with both clients authenticated.

The no-model protocol gate exercised the same production gateway 30 times and recorded 30/30 exact destination acceptances, 7/7 denied bypasses, 400/400 absent canaries, valid signatures and receipt chain, rejection of a modified receipt, and distinct commitments for 30 identical payloads. The protected 26,231-byte source was captured even with the ordinary threshold set to 100,000,000 characters. A constructed direct transcript was 31,013 bytes; the source plus signed opaque-flow result was 2,628 bytes, 91.5% lower. Local p95 flow latency was 0.91 ms over 30 samples on the recorded machine. Inspect the [protocol receipt](./benchmarks/results/mcp-opaque-flow.first-party-macos-arm64-20260715.json) or run `npm run bench:mcp-opaque-flow` without a provider call.

These tests prove exact behavior for committed synthetic traces, not semantic noninterference, production demand, or a universal security guarantee. Counts, sizes, field names, timing, and success remain visible. The wrapped process is trusted with values, and receipt keys are ephemeral session keys rather than operator identity certificates. The [value-opaque design note](./planning/value_opaque_mcp_dataflow.md) compares verified prior art and lists the remaining breakthrough gates.

### Cross-host MCP gateway gate

Claude Code 2.1.197 and GitHub Copilot CLI 1.0.71-2 independently used the production gateway against the same disposable synthetic MCP server. The upstream `accounts_list` tool intentionally had no filter and returned 1,000 records under `structuredContent.data.accounts`. Both clients received the same artifact id and returned exactly `user733@example.com`.

| Host | Model | Upstream call | Exact query | Final answer | Bounded result evidence |
|---|---|:---:|:---:|:---:|---|
| Claude Code | Claude Haiku 4.5 | Yes | Yes | Exact | Largest model-visible tool result: 508 characters |
| GitHub Copilot CLI | GPT-5.3 Codex | Yes | Yes | Exact | Largest complete tool-event record: 2,840 characters; includes event metadata |

Claude autonomously performed this sequence:

1. discovered and called `mcp__accounts__accounts_list`;
2. received a 508-character artifact result instead of the 81,665-character structured payload, a 99.4% reduction in model-visible characters for that tool result;
3. called `mcp__accounts__pinpoint_query` with `accountId: 733` and `fields: ["email"]`;
4. returned exactly `user733@example.com`.

The final artifact-asserting gate completed in four agent turns for $0.020339 observed provider cost. Filesystem, shell, subagent, and editing tools were denied, and the run failed unless both MCP calls occurred, exactly one expected artifact id appeared, every visible tool result stayed below 5,000 characters, and the final answer matched exactly. Inspect the [content-free receipt](./benchmarks/results/mcp-gateway-agent.first-party-macos-arm64-20260715.json) or rerun `npm run bench:mcp-gateway:agent` with Claude Code authenticated.

Copilot auto-routed to `gpt-5.3-codex`, exposed only the synthetic `accounts` MCP server, called both tools, changed no files, and used zero premium requests. Rerun with `npm run bench:mcp-gateway:copilot`.

Inspect the [cross-host receipt](./benchmarks/results/mcp-gateway-cross-host.first-party-macos-arm64-20260715.json). Cursor was not authenticated and Codex was blocked by local configuration/authentication, so neither is counted. This remains one first-party synthetic compatibility task, not an estimate of organic prevalence or a universal quality claim.

### Provider-wire QCV evidence gate

The provider-wire receipt covers 30 synthetic task templates with five independently parameterized variants each. Every one of the 150 paired observations has a distinct payload, expected answer, task ID, and fixture hash. Each runs three randomized arms: raw provider input, Headroom-only semantic compression, and Pinpoint QCV. The gate used Claude Haiku 4.5 through Anthropic Messages and GPT-4.1 mini through both OpenAI Chat Completions and Responses.

| Arm | Exact score | Provider input | Modeled provider cost |
|---|---:|---:|---:|
| Raw | 109/150 | 1,899,030 | $1.198998 |
| Headroom | 112/150 | 1,713,184 | $1.062131 |
| **Pinpoint QCV** | **150/150** | **48,439** | **$0.034462** |

Against raw requests, modeled provider cost was 97.1% lower. Against Headroom, QCV used 97.2% fewer input tokens and 96.8% lower modeled provider cost. The paired-bootstrap 95% cost-reduction interval was 96.5%-96.9%. There were zero paired regressions and 38 improvements; the exact one-sided 95% upper bound on harm was 1.98%, below the predeclared two-point non-inferiority margin. That inferential bound treats the 150 fixed, independently parameterized variants as exchangeable benchmark units; it is not a confidence bound for organic traffic.

<details>
<summary><strong>View the provider-wire receipt graphic</strong></summary>

<br>

<img src="./assets/qcv-evidence-gate.svg" alt="Controlled provider-wire QCV gate: 150 of 150 eligible synthetic variants exact, with modeled provider cost 96.8% lower than Headroom" width="920">

</details>

All 150 tasks were deliberately eligible for provider-wire QCV. This proves conditional efficacy after a large exact result reaches provider history. It does not measure how frequently modern coding CLIs produce that traffic.

The run made 450 paid calls with no harness retries and observed $2.295591 in provider spend. Inspect the [full repeated receipt](./benchmarks/results/evidence-gate.first-party-macos-arm64-20260715.json).

### Historical provider-proxy agent gate

Five real Claude Code sessions and five real Codex CLI sessions ran in disposable synthetic repositories through the production proxy. The grader parsed only Claude's final `result` or Codex's last `agent_message`; all 10 returned the single correct email value. All 10 minimized sanitized traces replayed hash-identically, stable cache shape was observed, four long/join sessions completed, and both injected provider POST failures were retried by the agents.

Claude Code exercised QCV on line-numbered `Read` output. Codex queried sub-6,000-character chunks locally, so Pinpoint correctly left those requests unchanged. The source captures, agent outputs, credentials, and personal paths were deleted; only reviewed synthetic derivatives remain. Inspect the [agent receipt](./benchmarks/results/agent-trace-gate.first-party-macos-arm64-20260715.json) and [sanitized traces](./benchmarks/traces/agent-gate/).

These are first-party real-agent sessions over synthetic data, not customer production traces. Copilot subscription traffic is outside provider-wire QCV scope; the new MCP gateway is independent of provider authentication.

### Historical paid exact-context pilot

The earlier pilot used two fixed Haiku 4.5 tasks sent directly to Anthropic and through Pinpoint:

- Provider-reported input fell from **22,614 to 594 tokens**.
- Modeled cost fell from **$0.022684 to $0.000664**.
- Exact score improved from **1/2 to 2/2**.

On the log task, the raw model answered `5` for a fixture containing seven errors. Pinpoint counted the exact local lines and returned `7`. See the [raw paid result](./benchmarks/results/direct-anthropic-virtual.json).

A separate three-task pilot tested the optional general compression path. Input fell from 24,249 to 14,478 tokens with the same 2/3 exact score. That result validates the integration path rather than Pinpoint's exact-context algorithm.

Those pilots remain useful negative and design-history evidence, but the repeated gate above supersedes them as the primary quality result.

Run the offline checks or repeat either paid gate from a clean machine using the [benchmark reproduction guide](./benchmarks/REPRODUCING.md). Labeled replication runs write separate receipts instead of replacing the committed artifacts.

### Broader offline token accounting

The offline corpus runs real Pinpoint transforms over agent-shaped requests and compares the resulting input with the original raw request:

| Workload | Raw input | Pinpoint input | Input saved |
|---|---:|---:|---:|
| JSON tool output + static context | 18,662 | 9,184 | **50.8%** |
| Build log + static context | 18,309 | 10,063 | **45.0%** |
| Source output + static context | 12,049 | 5,846 | **51.5%** |
| **Total** | **49,020** | **25,093** | **48.8%** |

This offline result validates transformation and token accounting, not model quality. The repeated live gate above measures model quality on its committed synthetic task family. Cache behavior, model choice, and how often organic requests match the exact rules can change the net saving.

The broader exact-data test suite runs 42 deterministic tasks across JSON lookup, filtered counts, logs, source exports, tabular JSON, nested projections, and one-hop unique-key joins. It produced 42/42 exact materializations, replaced the large old tool output in 42/42 cases, and never exposed model-planned retrieval. The measured tool-output regions fell from 144,272 to 7,583 estimated tokens. It also refused 20/20 ambiguous, competing-dataset, unsafe-join, and lossy-number controls. This is offline operation coverage, not live-model quality evidence.

The full [benchmark report](./benchmarks/REPORT.md) keeps live, offline, agentic, and simulated evidence separate. It also preserves failed experiments instead of averaging them into successful results.

</details>

## Safety and privacy

- Opaque-flow policies are operator-owned JSON loaded before startup. The model cannot choose an arbitrary source, destination, payload argument, operation, field, or limit.
- Configured source tools are fail-closed at every result size. Protected content, metadata, extension fields, JSON-RPC errors, stderr, and unsolicited server messages are not forwarded as alternate value paths.
- Strict flow mode uses random 128-bit process-local capabilities. Public content hashes, artifact resources, previews, `pinpoint_query`, and direct hidden-destination calls are disabled by default.
- Flow receipts expose field names, counts, sizes, limits, and success status. Values are represented by per-sequence HMAC-SHA256 commitments; equal values do not produce equal public commitments.
- Receipts are Ed25519-signed and hash-chained. The session verification key is pinned at MCP initialization. This detects receipt modification but is not operator identity, hardware attestation, or proof that the upstream process is honest.
- The wrapped upstream process is trusted with source and destination values. Pinpoint does not stop that process from using its own network, filesystem, subprocess, timing, or other operating-system channels.
- The MCP gateway spawns the configured upstream command directly with `shell: false`. Upstream arguments are never interpolated into a shell command.
- Gateway artifacts stay in bounded process memory and disappear at shutdown. Text blocks retain their exact text. Structured content is retained as canonical JSON after MCP parsing.
- Store capacity is reserved atomically before a handle is emitted. If the artifact cannot fit, the complete original result passes through instead of producing a dead reference.
- `pinpoint_query` accepts only bounded deterministic operations and caps every result. `resources/read` returns a bounded preview, never the complete unbounded artifact.
- Outside configured opaque-flow sources, error results, media, mixed content, ambiguous nested collections, and unsupported output pass through unchanged. The host may still apply its own truncation to those results.
- Upstream MCP output is untrusted. Virtualization reduces initial exposure, but queried rows or lines can still contain prompt injection or malicious data and must be treated like any other tool result.
- Pinpoint binds to `127.0.0.1` by default. It has no public login or access-control layer, so do not expose it directly to the internet.
- Provider credentials are forwarded to the configured provider and are not stored by Pinpoint.
- QCV stores replaced tool results in process memory with a default cap of 256 datasets or 64 MiB and least-recently-used eviction.
- Reversible compression handles are separately limited to 1,000 entries or 64 MiB, expire after 30 minutes, and are cleared at shutdown. A request is left unchanged if its own reversible batch cannot fit.
- A Headroom process started by Pinpoint is forced to loopback, one worker, stateless mode, and in-memory CCR; provider credential variables are not inherited. A custom `PINPOINT_HEADROOM_URL` follows that external service's network and retention policy and receives the selected content sent for compression.
- Audit and shadow modes preview changes without storing exact datasets or changing requests.
- Failed changes, unavailable modules, unsupported traffic, and unsafe questions leave the affected content unchanged.
- The experimental model-planned fallback is disabled by default and has a separate switch.
- Local retrieval calls run inside the proxy only when every tool call in the response belongs to Pinpoint. Mixed tool ownership replays the original request.
- Durable capture is off by default and records metadata only unless `PINPOINT_CAPTURE_BODIES=1` is explicitly set. Body-enabled files contain private prompts and are readable only by your operating-system user (file mode `0600`).
- OpenTelemetry events never include request or response content.

See the [security policy](./SECURITY.md) before exposing the proxy outside a trusted machine or network.

## Configuration (optional)

The defaults are designed for local use. These are the controls most people need:

| You want to | Set |
|---|---|
| Change the proxy port | `PINPOINT_PORT=9000` |
| Preview without changing requests | `PINPOINT_MODE=shadow` |
| Turn off the exact-data path | `PINPOINT_VIRTUAL_CONTEXT=0` |
| Reduce logs | `PINPOINT_LOG=warn` |

<details>
<summary><strong>All environment variables</strong></summary>

<br>

| Env | Purpose | Default |
|---|---|---|
| `PINPOINT_HOST` / `PINPOINT_PORT` | listen interface / port | `127.0.0.1` / `8788` |
| `PINPOINT_MCP_MIN_CHARS` | ordinary MCP result-firewall threshold | `16000` |
| `PINPOINT_MCP_FLOW_CONFIG` | versioned value-opaque flow policy file | unset |
| `PINPOINT_MAX_INSPECTION_BYTES` | maximum request bytes buffered for optimization; larger requests stream unchanged | `33554432` |
| `PINPOINT_MODE` | `audit` (no processors), `shadow` (propose only), `optimize` (commit), `enforce` (reserved output policy) | `optimize` |
| `PINPOINT_VIRTUAL_CONTEXT` | exact-data path; set `0` to turn it off | `on` |
| `PINPOINT_VIRTUAL_QUERY_FALLBACK` | model-planned retrieval for harder Anthropic questions (experimental) | `off` |
| `PINPOINT_VIRTUAL_MIN_CHARS` / `PINPOINT_VIRTUAL_MAX_CHARS` | old tool-output size range | `6000` / `2000000` |
| `PINPOINT_VIRTUAL_MAX_ENTRIES` / `PINPOINT_VIRTUAL_MAX_STORED_BYTES` | in-process exact-store limits | `256` / `67108864` |
| `PINPOINT_VIRTUAL_MAX_DATASETS_PER_REQUEST` | maximum datasets virtualized in one request | `8` |
| `PINPOINT_VIRTUAL_MAX_QUERY_ROUNDS` | hidden query fallback round cap | `4` |
| `PINPOINT_CCR_CONTINUATION` | execute pure local retrieval calls inside the proxy | `on` |
| `PINPOINT_CCR_MAX_CONTINUATION_ROUNDS` | maximum extra provider rounds for local retrieval | `3` |
| `PINPOINT_CCR_MAX_ENTRIES` / `PINPOINT_CCR_MAX_STORED_BYTES` | in-process reversible handle limits | `1000` / `67108864` |
| `PINPOINT_CCR_TTL_MS` | reversible handle retention time | `1800000` |
| `PINPOINT_HEADROOM_REQUEST_TIMEOUT_MS` | local compression/retrieval request timeout | `60000` |
| `PINPOINT_CAPTURE_PATH` | fsynced JSONL optimization capture | unset |
| `PINPOINT_CAPTURE_BODIES` | include sensitive bodies required for replay | `off` |
| `PINPOINT_CAPTURE_MAX_BYTES` / `PINPOINT_CAPTURE_MAX_FILES` | bounded JSONL rotation | `268435456` / `3` |
| `PINPOINT_OTLP_ENDPOINT` | OpenTelemetry OTLP/HTTP endpoint | unset |
| `PINPOINT_OTLP_HEADERS` | collector headers as comma-separated `key=value` pairs | unset |
| `PINPOINT_OPTICAL` / `PINPOINT_SEMANTIC` | image-based and text-based compression switches | `on` |
| `PINPOINT_MODELS` | models allowed to use image-based compression; `off` disables it | `claude-fable-5` |
| `PINPOINT_SEMANTIC_PROSE` | text-compress large prose from older user turns | `off` |
| `PINPOINT_OPTICAL_ON_SUBSCRIPTION` | allow lossy image-based compression on subscription traffic | `off` |
| `PINPOINT_LOG` | `silent`\|`error`\|`warn`\|`info`\|`debug` | `info` |

</details>

Advanced exact-data limits are documented in the [design note](./planning/query_backed_context.md). Run `pinpoint help` for CLI options and `pinpoint doctor` to inspect the local runtime.

## Integrations

You can use Pinpoint's exact-context path and demo with Node.js alone. Python is not required.

Pinpoint owns the proxy, exact-data path, provider adapters, safe change planning, and savings reports. Its public integration API also lets compression and policy modules propose changes without taking over routing or safety rules.

Two standalone examples live in [`examples/integrations`](./examples/integrations/README.md): a non-compression secret-redaction policy and a deterministic JSON tool-output minifier. They import only public package exports and run with built-ins disabled.

The package includes [pxpipe](https://github.com/teamchong/pxpipe) for supported image-based compression inside the Pinpoint process. [Headroom](https://github.com/headroomlabs-ai/headroom) adds optional text-aware compression through a small local background process:

```bash
pip install headroom-ai
pinpoint doctor
```

If that background process is unavailable, its stage does nothing while the exact-data path and other available modules continue. Configure an existing process with `PINPOINT_HEADROOM_URL`, or disable auto-start with `PINPOINT_HEADROOM_AUTOSPAWN=0`. Only use an external sidecar you trust with the selected tool output and prose sent for compression. See [UPSTREAM.md](./UPSTREAM.md) for versioning and attribution.

## Built at CodePal

Pinpoint open-sources the MCP policy gateway and evidence harness developed at [CodePal](https://codepal.ai). It is not CodePal's complete product, identity layer, model stack, or hosted infrastructure.

CodePal builds AI development tools for moving from an idea to production software. Visit [codepal.ai](https://codepal.ai) for the full product.

## Contributing

Start with [`CONTRIBUTING.md`](./CONTRIBUTING.md). The main local checks are:

```bash
npm run typecheck
npm test                        # offline test suite
npm run bench:mcp-opaque-flow   # 30 flows + 7 bypasses, no provider call
npm run bench:mcp-opaque-flow:cross-host # Claude Code + Copilot live gate
node benchmarks/proof.mjs       # constructed additivity check
node benchmarks/rd_frontier.mjs # simulated RD surface
node benchmarks/adaptive.mjs    # controller simulation
npm run bench:virtual           # QCV vs current full stack, no provider calls
npm run bench:qcv-quality       # 42 exact tasks + 20 refusal controls, no provider calls
npm run bench:profile           # paired direct-vs-proxy local profile + raw samples
npm run bench:profile:isolated  # separate load, proxy, and upstream processes
```

Questions, integration ideas, independent benchmark runs, and sanitized field reports belong in [GitHub Discussions](https://github.com/CodePalAI/pinpoint/discussions). Reproducible defects and optimizer proposals use the structured [issue forms](https://github.com/CodePalAI/pinpoint/issues/new/choose).

## Status

Pinpoint is experimental and available today for controlled local or VPC-side evaluation.

Pinpoint is developed and maintained by [CodePal](https://codepal.ai) with contributions from the open-source community.

- **Validated first-party:** the value-opaque flow passed on Claude Code and GitHub Copilot CLI; the protocol gate completed 30/30 exact destinations, denied 7/7 bypasses, and found zero of 400 canaries in its client transcript.
- **Still being proved:** independent security review, broader host replication, externally sourced workflows, multi-server authority boundaries, operator identity keys, formal confinement analysis, and customer demand.

The [product assessment](./planning/product_assessment.md) explains the evidence and current limits without marketing shortcuts.

## License

**Apache-2.0.** Third-party attribution is listed in [`NOTICE`](./NOTICE).

Pinpoint is an open-source CodePal project. Contributions are welcome under [`CONTRIBUTING.md`](./CONTRIBUTING.md) and the [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md). Report vulnerabilities through the private process in [`SECURITY.md`](./SECURITY.md), not a public issue.

