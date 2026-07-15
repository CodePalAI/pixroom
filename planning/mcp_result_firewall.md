# MCP result firewall

_Status: implemented experimental path, 2026-07-15._

## Product thesis

The model API proxy is too late for the strongest oversized-tool-output failures. Claude Code may reject an MCP result, Codex may truncate it, and Copilot or VS Code may spill it before the next provider request exists. A provider proxy cannot recover bytes it never receives.

Pinpoint therefore moves exact context virtualization to the MCP boundary:

```text
MCP host -> Pinpoint gateway -> unmodified upstream stdio server
         <- compact handle  <- exact result retained locally
         -> pinpoint_query  -> bounded deterministic answer
```

The gateway is provider-independent and works with API-key, OAuth, or subscription clients. The host keeps its normal model and login.

## Invocation

```bash
pinpoint mcp gateway [--min-chars N] -- <upstream-command> [args...]
pinpoint mcp gateway --flow-config <policy.json> -- <upstream-command> [args...]
```

The upstream process is spawned directly with `shell: false`. The gateway forwards newline-delimited JSON-RPC 2.0 messages over stdio in both directions, including requests, responses, notifications, and server-initiated messages.

The existing `pinpoint mcp` standalone server remains separate.

## Host-visible contract

`tools/list` preserves every upstream tool name, description, and input schema. Pinpoint appends one reserved tool:

- `pinpoint_query`: bounded `schema`, `json_select`, `count`, `grep`, `slice`, and `json_join` operations.

If an upstream tool declares an object `outputSchema`, the gateway advertises an object-root `anyOf` union:

1. the original output schema;
2. the Pinpoint artifact envelope.

The explicit root `type: "object"` is required for Claude Code's strict MCP validator.

Eligible oversized `tools/call` results become:

- a short text manifest;
- a `resource_link` with URI `pinpoint://artifact/<id>`;
- structured metadata under `pinpointArtifact`;
- bounded access through `pinpoint_query` and `resources/read`.

The full payload is not returned to the host in that call.

## Value-opaque flow mode

Loading a versioned flow policy creates a separate confidentiality contract. Named source tools are captured regardless of result size or envelope profitability and fail closed when exact capture is impossible. Query/resources are hidden, artifact ids become random process-local capabilities, and the configured destination tool is called only inside the gateway with an allowlisted exact projection. Client-visible output is an Ed25519-signed, hash-chained receipt with per-sequence HMAC commitments rather than values.

This mode validates source and destination names against the first complete upstream tool catalog before accepting any tool call. Source metadata, result extensions, JSON-RPC errors, stderr, and unsolicited server messages are not preserved as alternate value paths. Ordinary unconfigured tools retain the fail-open rules below.

See `planning/value_opaque_mcp_dataflow.md` for policy syntax, receipt semantics, evidence, threat model, and verified prior art.

## Exact artifact model

Artifact ids are SHA-256-derived `vctx_` identifiers. Text results retain the exact text block. Structured results are retained as canonical JSON after MCP parsing.

JSON arrays are directly queryable. For wrapped structured results, Pinpoint searches at most three object levels for record arrays. It uses a nested collection only when exactly one candidate exists. The descriptor records its `dataPath`, while the store keeps the complete wrapper payload.

Examples of accepted unambiguous shapes:

```json
{"results":[{"id":1},{"id":2}]}
{"data":{"accounts":[{"accountId":1},{"accountId":2}]}}
```

A wrapper with multiple competing record arrays stays an object and is not silently assigned the wrong collection.

## Eligibility and fail-open rules

A result is virtualized only when all conditions hold:

1. the call did not return `isError: true`;
2. the exact payload is one text block or a structured JSON object;
3. its character length meets the configured threshold;
4. the artifact envelope is smaller than the original call result;
5. bounded local storage can retain the artifact atomically.

The original result passes through unchanged for:

- errors;
- media or mixed content blocks;
- small or unprofitable results;
- unsupported payloads;
- insufficient storage;
- internal transformation failures.

No handle may be emitted before the corresponding artifact is committed. If the new artifact cannot fit after least-recently-used eviction, the transaction fails and the original result is returned.

## Bounded disclosure

The default store holds at most 256 artifacts or 64 MiB. Artifacts disappear with the gateway process.

Query outputs use the virtual store's independent result cap. `json_select` and `slice` cap row counts; `grep` caps lines; joins require one unique source row, one unique destination row, a key-shaped shared field, and a complete bounded projection.

`resources/read` returns artifact metadata and a first-page preview. It is not a full-content escape hatch.

## Threat model

Upstream MCP output is untrusted and may contain prompt injection, malformed data, secrets, or resource-exhaustion payloads.

The gateway reduces initial model exposure but does not declare queried content safe. A selected row or log line can still be malicious. Hosts must apply their normal tool-output trust policy.

Current controls:

- no shell interpolation for upstream commands;
- bounded in-memory retention and output;
- safe-integer checks for exact JSON operations;
- special-key-safe projection;
- conservative nested collection selection;
- upstream tool-name collision refusal for `pinpoint_query`;
- protocol diagnostics on stderr only;
- no provider credential persistence.

## Relationship to existing techniques

Native hosts and agent runtimes already spill large output to files, truncate results, compress logs, or expose load-and-search tools. Those are valid prior art. Pinpoint does not claim that storage plus retrieval is novel.

The narrower differentiation is the combination of:

- one wrapper command for an arbitrary unmodified stdio MCP server;
- provider- and host-independent interception before context ingestion;
- protocol-native resource handles instead of a host-local filesystem assumption;
- deterministic structured operations and strict unique-key joins;
- output-schema compatibility for small original results and large artifact envelopes;
- atomic fail-open retention rather than lossy truncation.

This is a breakthrough candidate only if external traces show recurring oversized results and real agents preserve quality through the query step. Implementation novelty alone is not product validation.

## Evidence

Focused automated coverage validates:

- transparent initialize/list/call forwarding;
- resource capability merging;
- exact query recovery;
- nested structured wrappers;
- output-schema unioning;
- capacity fail-open behavior;
- small/error pass-through.

The cross-host receipt records the same task on Claude Code and GitHub Copilot CLI. Both clients called the unfilterable upstream tool, received the same SHA-derived artifact id, called `pinpoint_query`, and returned the exact requested email. Claude's 81,665-character structured result became a 508-character model-visible artifact result; Copilot's complete tool-completion event stayed at 2,840 characters including metadata and used zero premium requests. This proves compatibility across two host/model families for one task, not organic prevalence.

See `benchmarks/results/mcp-gateway-cross-host.first-party-macos-arm64-20260715.json`.