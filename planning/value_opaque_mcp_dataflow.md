# Value-opaque MCP dataflow

_Status: implemented experimental path with operator-rooted protocol,
bounded-model, published-OSS, and two-executed-host evidence, 2026-07-16._

## Contribution statement

Pinpoint can move an exact, policy-approved projection from one tool result into
another tool call without placing the projected values in the MCP client or model
transcript. It does this as a transparent stdio gateway around an unmodified MCP
source server and, optionally, a separately spawned unmodified private destination
server. No generated code, sandbox, host plugin, or tool implementation change is
required.

The narrow contribution is the integrated protocol mechanism:

1. an operator names a source tool, destination tool, destination argument,
  deterministic operations, operator-fixed predicates, dynamic filter fields,
  projection fields, dynamic argument names, and byte/item limits in a versioned
  JSON policy;
2. the configured source becomes fail-closed at every result size, independent of
   the normal optimization threshold or profitability check;
3. Pinpoint stores the exact result locally and returns a random 128-bit session
   capability rather than a public content hash;
4. the model calls only `pinpoint_flow` with that capability and a query that must
   fit the policy;
5. Pinpoint resolves the exact query locally and calls the hidden destination tool
   internally with the selected value;
6. the source values, internal destination arguments, and destination result values
   do not cross the client-facing JSON-RPC boundary;
7. the client receives a value-free, HMAC-committed, Ed25519-signed, hash-chained
  execution receipt;
8. optional authority mode uses a stable operator key to delegate the fresh receipt
  key to an unlinkable commitment of the complete normalized policy, including
  fixed values, without publishing those values.

No ingredient above is new by itself. The research claim is the interoperability
combination and its measured disclosure boundary, not invention of capabilities,
information-flow control, tokenization, signatures, or tool composition.

## Invocation

```bash
pinpoint mcp gateway \
  --flow-config ./flow-policy.json \
  -- <upstream-command> [args...]
```

Optional operator-rooted mode:

```bash
pinpoint mcp authority init --out ./operator.pem
pinpoint mcp gateway \
  --flow-config ./flow-policy.json \
  --flow-authority-key ./operator.pem \
  --flow-authority-opening ./authority-opening.json \
  -- <upstream-command> [args...]
```

Private keys and opening records are created with mode `0600` and never overwrite
existing files. The opening record carries a policy authorization signature, not
plaintext values, but it enables testing candidate policies and is therefore
sensitive.

Optional private-destination mode:

```bash
pinpoint mcp gateway \
  --flow-config ./flow-policy.json \
  --destination-config ./destination.json \
  -- <source-command> [args...]
```

The destination deployment config is separate from flow policy. `envAllowlist`
copies named variables into that process and removes those names from the source;
`sharedEnvAllowlist` is the explicit subset permitted in both environments. Values
remain outside JSON and the public receipt.

`PINPOINT_MCP_FLOW_CONFIG` can supply the same file path. The policy is loaded and
validated before the upstream process starts. Unknown top-level fields, unsupported
versions, duplicate flow names, missing projection allowlists, overlapping fixed and
dynamic destination arguments, invalid limits, and missing upstream tools fail closed.

Do not place provider credentials or long-lived secrets in
`fixedDestinationArguments`; the policy is a plaintext operator configuration file.
Keep authentication in each server's normal environment or workload-identity
mechanism, never command arguments or destination JSON.

See `examples/mcp-opaque-flow.json` for a complete policy and
`examples/mcp-opaque-flow.schema.json` for the editor/tooling schema. The separate
deployment example is `examples/mcp-opaque-destination.json`. Runtime
validation remains authoritative because it also checks semantic constraints such as
projection requirements and argument overlap.

## Protocol path

```text
MCP host / model
  |
  | call source tool
  v
Pinpoint gateway ---------------------> unmodified source server
  |                                          |
  | exact local artifact <------------------+
  | random capability only
  v
MCP host / model
  |
  | pinpoint_flow(capability, allowed query)
  v
Pinpoint policy + exact query engine
  |
  | selected values (internal JSON-RPC only)
  v
private unmodified destination server
  |
  | destination result (internal only)
  v
Pinpoint gateway
  |
  | signed commitment-only receipt
  v
MCP host / model
```

The model controls which configured flow to use and may provide only the dynamic query
dimensions and non-payload arguments named by that flow. `fixedWhere` predicates are
always merged locally and cannot be supplied, omitted, or overridden by the model. The
operator, not the model, controls source, destination, and fixed business-rule
authority.

With `--destination-config`, Pinpoint initializes and catalogs the private peer
independently before accepting flows. It has a separate request namespace, timeouts,
stderr suppression, and shutdown path. Its tools are never merged into the host
catalog. Authority mode commits the destination command, arguments, working
directory, environment names, and explicitly shared environment names without
publishing them.

## Strict defaults

Passing any `flows` to `runMcpGateway()` enables these defaults unless the caller
explicitly overrides them:

- `pinpoint_query` is not exposed;
- Pinpoint artifact resources and previews are not exposed;
- artifact identifiers are random capabilities, not deterministic content hashes;
- destination tools are hidden unless a policy explicitly opts out;
- configured source tools are captured at any size and fail closed;
- `tools/list` must validate every configured source and destination before any
  tool call is accepted.

The CLI parser applies the same defaults. Ordinary gateway use without a flow policy
keeps the existing result-firewall behavior: eligible transformations fail open and
`pinpoint_query` plus bounded resources remain available.

## Policy enforcement

The current deterministic operation set is `json_select`, `count`, `grep`, and
`slice`. `json_join` is intentionally excluded from opaque flows until a policy can
name and validate both source provenances.

For `json_select`, `allowedFields` is mandatory. Omitting `fields` cannot silently
send a complete row. `fixedWhere` supplies operator-owned primitive equality
predicates; `allowedWhereFields` separately names fields the model may add. Fixed and
dynamic where fields cannot overlap. Dynamic filter fields and dynamic destination
argument names default to empty allowlists. Fixed destination arguments are loaded
from operator policy and cannot be overridden by the model. Item, selected-payload
byte, and non-payload destination-argument byte limits are enforced before dispatch.

The source artifact records its originating tool. A capability produced by any other
tool is rejected even if its shape and fields match. Source kind can also be bound to
`json-array`, `json-object`, or `lines`.

## Receipt contract

Each successful or destination-error flow produces one `McpOpaqueFlowReceipt`.
It includes:

- sequence number and previous receipt hash;
- flow, source tool, destination tool, optional logical destination-server id,
  destination argument, and operation;
- filter field names, projection field names, and non-payload destination argument
  names, but not their values;
- policy-shape SHA-256 and enforced item/byte limits;
- item count and selected-payload byte count;
- per-sequence HMAC-SHA256 commitments to the query, selected payload, and destination
  result;
- destination success status;
- session signing-key id, Ed25519 public key, receipt hash, and signature.
- in authority mode, the stable operator key id, fresh session-key delegation,
  per-session policy nonce, hidden complete-policy commitment, and operator signature.

The HMAC key never leaves the gateway. Including the sequence in each commitment
prevents equal payloads from producing linkable public commitments. The Ed25519
verification key and key id are pinned in the MCP `initialize` result before any
receipt is emitted. `verifyMcpOpaqueFlowReceipt(receipt, initializedVerifier)` verifies
the pinned key identity, receipt hash, and signature. Omitting the second argument
checks only the receipt's self-contained signature. A receipt chain verifier must
additionally check monotonically
increasing sequence numbers and each `previousReceiptHash`.
Sequence numbers record serialized terminal receipt emission order, not destination
dispatch start time. Concurrent flows may therefore complete in a different order than
they were dispatched while still forming one valid chain.

Authority mode proves that the configured operator key authorized the fresh session
key and exact hidden policy/deployment commitment. It does not prove who owns that
key, that a human approved it, executable identity, hardware protection, complete
retention, or upstream honesty. External witnesses or a transparency service are
needed to detect omission or equivocation across sessions.

## Threat model

Trusted components:

- the local Pinpoint process and exact query engine;
- the operator-supplied flow policy;
- the source and destination processes as recipients of their respective values;
- the operating system process boundary.

The wrapped process is also trusted to preserve JSON-RPC request/response identity.
Pinpoint rejects duplicate outstanding client ids but cannot distinguish a malicious
upstream that deliberately returns one valid outstanding id for another request; such a
process can already exfiltrate through its own trusted network, filesystem, and tool
results.

Protected boundary:

- client-facing MCP stdout and model-visible host events must not contain source
  values selected for an opaque flow or destination result values.

Controls:

- source result content, `_meta`, and arbitrary result extensions are replaced by
  the artifact envelope;
- source JSON-RPC errors are sanitized;
- upstream stderr and unsolicited server messages are suppressed after protected
  data has been handled;
- direct calls to hidden destinations and disabled query access are rejected;
- resource preview access is not advertised and artifact URIs cannot be read;
- public content hashes are not emitted;
- random capabilities are checked against process-local provenance and LRU state;
- exact query results and destination arguments are bounded before dispatch;
- destination results are committed and discarded rather than returned.

Observable metadata remains: tool names, flow names, field names, operation, item and
byte counts, timing, success/error status, receipt sequence, and policy shape. Pinpoint
does not claim semantic noninterference for those side channels.

Out of scope:

- a malicious upstream process can exfiltrate values over its own network, files,
  subprocesses, timing, or other OS channels;
- separate source/destination processes run under the same OS user unless the operator
  adds stronger isolation; environment filtering does not prevent shared files,
  keychains, workload identities, IPC, or network access;
- destination command and catalog validation do not attest executable/package identity;
- an upstream server may expose the same data through a separate unprotected tool or
  resource;
- source call arguments originate at the client and remain visible;
- process-local artifacts are not durable and do not survive gateway restart;
- one private stdio destination is supported; multiple destinations and remote
  HTTP/OAuth authorization brokering are not;
- destination failure after dispatch cannot prove whether a side effect occurred;
  `destinationSucceeded=false` means success was not confirmed, not rolled back;
- paginated tool catalogs are not accepted for initial policy validation in this
  experimental version.

## Evidence

### Protocol integration

`benchmarks/v2/mcp_opaque_flow_gate.mjs` runs the production gateway against an
unmodified deterministic stdio fixture with the normal virtualization threshold set
to 100,000,000 characters. The 26,231-byte protected source is captured anyway.

The committed run records:

- 30/30 exact hidden destination acceptances;
- 8/8 denied bypass attempts: direct query, resource read, direct destination,
  forbidden projection, forbidden operation, forged capability, fixed-argument
  override, and operator-fixed predicate override;
- 400 exact private canaries scanned with zero client-transcript occurrences;
- no public source or selected-payload hash occurrence;
- 30/30 valid signatures and one valid receipt chain;
- valid operator delegation and exact complete-policy opening;
- modified receipt, modified authority, and wrong operator root rejected;
- identical payloads producing 30 distinct public commitments;
- 31,013 constructed direct-transcript bytes versus 3,414 opaque-flow bytes, 89.0%
  lower for the same source and destination payload;
- 0.84 ms p95 internal-flow latency over 30 local samples on the recorded machine.

This is protocol-integration evidence, not a provider token bill, model-quality test,
production demand measurement, or formal noninterference proof.

### Live cross-host execution

`benchmarks/v2/mcp_opaque_flow_cross_host_gate.mjs` asks installed Claude Code and
GitHub Copilot CLI clients to execute the same authorized synthetic flow. Each client
called only the visible source and `pinpoint_flow`; neither model called the hidden
destination or `pinpoint_query`. Both signed receipts verified, both destinations
accepted the exact 40-record projection, both clients returned exactly `VALIDATED`,
and no fixture value or public value hash appeared in either retained event-stream
grade. Both receipts validated under one shared operator root with distinct fresh
session keys and policy commitments. The aggregate scan covered 800 canaries. Claude
observed $0.022547 in provider cost; Copilot reported zero premium requests and zero
file changes.

This proves the same contract is usable by two host/model families for one synthetic
task. It does not estimate organic need, establish behavior on every MCP host, or
replace an external security review.

### Published cross-server execution

`benchmarks/v2/mcp_oss_cross_server_gate.mjs` composes two pinned unmodified
official packages in separate stdio processes. The filesystem server reads 200
synthetic records; operator-fixed policy selects 40 entity projections; the memory
server persists exactly those 40 into a disposable JSONL graph. The destination tool
is hidden, four native bypasses are denied, all 600 source canaries remain absent from the
client transcript, no destination-exclusive environment name remains in the source,
and the receipt, operator delegation, policy opening, and destination-server binding
verify.

This is first-party compatibility evidence for two packages and one persistent side
effect. It does not establish independent reproduction, executable identity, OS
isolation, exactly-once semantics, or product demand.

### Matched HCP mechanism comparison

The comparison gate pins Handle-Capability Protocol runtime 0.3.0 at
`e7eb50158f3d495f1dc99a2755abe08f0d0db716` and runs the byte-identical
200-record, 40-entity, 600-canary workflow. Pinpoint completes the published
filesystem-to-memory path with 4/4 native denials and 0/600 canaries. HCP completes
30/30 fresh native-runtime repetitions with 4/4 different denials and 0/600
canaries.

The result does not choose a winner. HCP provides principal-bound handles, target
grant/scope/canonical-resource/capability checks, approval, data-class policy, and
richer deny-path audit. Pinpoint provides unmodified MCP interoperability,
operator-fixed row/field policy and bounds, separate process/environment domains,
and signed operator-rooted receipts. HCP's fixed predicate/projection lives in the
comparison source provider because its runtime policy does not express row-level
selection.

HCP's pinned public repository suite reports 293/296 passing due to three propagated
alpha-readiness failures over one README positioning mismatch; that failure is
preserved. Its unchanged native data-pipe demo and matched mechanism arm pass.
Microsoft Fides Gateway was inspected but excluded from scoring because its public
gateway does not bind a policy result to hidden source-to-destination dispatch.

## Prior art and novelty boundary

The closest verified work is substantial:

| Work | Established capability | Difference from this implementation |
|---|---|---|
| [Handle-Capability Protocol](https://arxiv.org/abs/2606.29073) | Owned opaque handles, principals, grants, source/target data-pipe authorization, and deny-path audit | Closest mechanism found; no matching evidence for signed durable authority, real independent auth domains, arbitrary unmodified servers, or disclosure-bounded execution receipts |
| [SCITT architecture (RFC 9943)](https://www.rfc-editor.org/rfc/rfc9943.html) and [COSE receipts (RFC 9942)](https://www.rfc-editor.org/rfc/rfc9942.html) | Issuer identity, transparent statement registration, trust anchors, and independently verifiable inclusion receipts | Already owns durable transparency architecture; it does not define MCP flow semantics or prove hidden tool execution |
| [Anthropic, Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) | Generated code can pass Google Drive values to Salesforce without values entering model context; tokenization can detokenize values in a later tool call; deterministic flow rules are proposed | Requires model-generated code and a sandbox/client implementation; no declarative exact-query capability or signed flow receipt is described |
| [Cloudflare Code Mode](https://blog.cloudflare.com/code-mode/) | MCP tools become TypeScript APIs in an isolated worker; intermediate values stay out of model context unless logged | Generated code and an execution sandbox remain in the trusted computing base |
| [Fides](https://arxiv.org/abs/2505.23643) and [Fides Gateway](https://github.com/microsoft/fides-gateway) | Formal IFC model, dynamic labels, deterministic policy enforcement, selective hiding, Rego policies, and upstream policy calls | Planner/tool instrumentation or labeled raw values; no matching transparent artifact projection into a hidden unmodified MCP destination with signed receipts was found |
| [NetworkNT MCP tokenization](https://www.networknt.com/product/mcp-gateway/tokenization.html) | Schema-marked request fields are tokenized before external tool invocation; response fields can be masked or tokenized | Protects marked fields through tokens; it is not a general stored-result query and destination-composition contract |
| [Proof-Carrying Agent Actions](https://arxiv.org/abs/2606.04104) | Runtime-neutral action certificates, approval/outcome receipts, and replay-ready proof | General governance model rather than value-opaque MCP dataflow |
| [enclawed](https://arxiv.org/abs/2604.16838) | MCP gateway hardening, signed modules, DLP controls, attestable peers, and tamper-evident audit | Gateway security and proof-carrying bundles, not hidden deterministic source-to-destination composition |
| [LeanCTX](https://github.com/yvgude/lean-ctx) | Exact archives, recovery handles, bounded query modes, gateway post-processing, and context proofs | Closest result-virtualization system found; no direct policy-bound opaque artifact-to-destination flow was located |

Capability references, object-capability security, deterministic projections, HMAC,
Ed25519, hash chains, deny-by-default policy, and audit receipts are all established
techniques.

The defensible statement is therefore:

> In the public systems and code searched as of 2026-07-16, we found no exact match
> for declarative, policy-bound, value-opaque MCP composition between unmodified tools
> through a transparent gateway, with fail-closed source capture and signed
> commitment-only execution receipts, without generated code or a sandbox.

That is an implementation and systems-contribution claim, not a patent opinion or a
claim that the broader goal of private tool composition is new.

## Breakthrough gate

The implementation now clears the internal feasibility and two-host compatibility
gates. Calling it a field-level breakthrough still requires independent work:

1. external reproduction on at least three host/server combinations;
2. adversarial review of policy parsing, protocol concurrency, capability lifetime,
   receipt verification, and side channels;
3. independent review of the checked state-machine model and its mapping to the
  TypeScript implementation;
4. independent reproduction of the completed HCP comparison and, where a faithful
  runnable equivalent exists, generated-code/tokenization or IFC comparison on task
  success, policy expressiveness, and trusted-computing-base boundaries;
5. externally sourced MCP workflows showing a recurring need for values to move into
   another tool without model inspection;
6. an externally pinned organizational trust root plus retained witnesses or
  transparency-log anchoring that can expose omitted or equivocated sessions;
7. independent review of multi-server process, credential, timeout, and authority
  boundaries, followed by remote or multi-destination work only where external
  workflows demand it.

Public blocking gates:

- [Independent clean-machine reproduction #14](https://github.com/CodePalAI/pinpoint/issues/14)
- [Independent security and confinement review #15](https://github.com/CodePalAI/pinpoint/issues/15)
- [Comparative private-composition evaluation #16](https://github.com/CodePalAI/pinpoint/issues/16)
- [Externally sourced workflow and retention demand #17](https://github.com/CodePalAI/pinpoint/issues/17)

Until those gates pass, the accurate label is **groundbreaking candidate mechanism
with first-party cross-host evidence**, not proven field breakthrough.