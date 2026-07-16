# Security policy

Pinpoint is maintained by [CodePal](https://codepal.ai).

Pinpoint is an experimental policy gateway for MCP data. It can prevent selected
source and destination values from entering the client-facing MCP transcript, but it
does not remove the need for application security review, network controls, upstream
tool authorization, or compliance assessment.

## Reporting a vulnerability

Use GitHub's private **Report a vulnerability** flow in the repository Security tab. Do not open a public issue with exploit details, credentials, private prompts, or raw agent traces. If private reporting is unavailable, email [support@codepal.ai](mailto:support@codepal.ai) to request a private channel and omit technical details from the first message.

Expect an acknowledgement within seven days. Maintainers will confirm scope, coordinate a fix and disclosure, and credit reporters who want attribution.

## Supported versions

Security fixes target the latest published release and the `main` branch. Older prerelease versions may require upgrading.

## Deployment boundaries

- Pinpoint listens on `127.0.0.1` by default. It is not an authenticated internet-facing gateway. Deploy it on a trusted host or behind your own network isolation and authentication.
- Opaque-flow policies are plaintext operator files. Do not put credentials or long-lived secrets in `fixedDestinationArguments`; keep authentication in the upstream server's existing credential mechanism.
- The operator policy, not the model, defines source and destination tools, operations, fields, filters, argument names, and payload limits. Configured source tools fail closed when exact capture is not possible. Unconfigured result optimization keeps separate fail-open semantics.
- Opaque artifacts and exact tool results remain in bounded process memory until LRU eviction or process exit. The default limits are 256 datasets and 64 MiB. Pinpoint does not persist them to disk.
- The wrapped MCP process is trusted with source and destination values. Pinpoint does not prevent that process from using its own network, filesystem, subprocesses, timing, or other operating-system channels.
- Client-visible receipts conceal values, not metadata. Tool and flow names, field names, operation, item count, byte count, timing, limits, and success status remain observable.
- Receipt signatures prove integrity under an ephemeral session key pinned during MCP initialization. They do not prove operator identity, user approval, hardware attestation, upstream honesty, or continuity across gateway restarts.
- Pinpoint returns signed flow receipts through MCP but does not persist them. If durable retention is required, configure the MCP host or an existing collector to store the value-free receipt. `PINPOINT_CAPTURE_BODIES=1` is not a receipt-retention feature and may persist sensitive prompt and tool values.
- Protected source content, result metadata, result extensions, JSON-RPC errors, stderr, and unsolicited upstream messages are suppressed from the client-facing boundary after protected handling begins. Treat this as a defense for the documented protocol path, not a substitute for process isolation.
- Provider credentials remain in the host or wrapped upstream environment. Do not place them in prompts, flow policies, captures, issue reports, or benchmark artifacts.
- Inline reversible originals are independently bounded to 1,000 entries or 64 MiB, expire after 30 minutes, and are cleared at shutdown. A transform rolls back if its own reversible batch cannot fit.
- Managed Headroom children bind to `127.0.0.1`, run stateless with in-memory CCR, and do not inherit provider credential variables. An operator-configured external `PINPOINT_HEADROOM_URL` is a separate trust boundary: selected compression content is sent there and its retention policy applies.
- Exact QCV is enabled only for PAYG Anthropic Messages and OpenAI Chat/Responses traffic. OAuth/subscription traffic passes through. Exact prefetch may be used with streaming responses; model-driven fallback may not.
- Model-driven QCV continuation is experimental and disabled by default. Enable it only after evaluating your own traces.
- Durable capture is disabled by default. Metadata-only capture excludes request bodies. `PINPOINT_CAPTURE_BODIES=1` stores private prompt/tool content in a mode-0600 local file and should be used only on trusted storage.
- OTLP spans contain bounded machine codes and token counters, never request/response bodies or arbitrary integration exception text. Collector headers may contain credentials and must not be logged or committed.
- Audit logs, bug reports, and benchmark fixtures must be sanitized. Treat agent context as potentially secret even when no credential pattern is visible.

## What Pinpoint does not certify

Pinpoint is not a data-loss-prevention suite, identity provider, remote-attestation
service, zero-retention guarantee, or compliance certification. The committed tests
establish exact behavior on synthetic protocol traces and two installed MCP clients.
They do not establish semantic noninterference, production demand, or fitness for a
specific regulatory regime.

Before a production deployment, review the full threat model in
[`planning/value_opaque_mcp_dataflow.md`](./planning/value_opaque_mcp_dataflow.md),
the [bounded formal property map](./planning/opaque_flow_formal_properties.md), run
the protocol and mutation gates against your own sanitized fixture, and obtain
independent security review appropriate to your data and systems.