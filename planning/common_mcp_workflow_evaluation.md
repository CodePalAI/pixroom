# Common MCP workflow evaluation

_Status: phase 1 executed on 2026-07-16; later phases require separate authorization._

## Question

For common MCP workflows, does Pinpoint preserve the exact task outcome while
reducing values placed at the MCP client boundary, and does it stay out of the way
when the upstream tool already returns a bounded result?

This evaluation compares two configurations over equivalent disposable fixtures:

- **Direct MCP:** the client receives the complete tool result and a deterministic
  grader computes the answer.
- **With Pinpoint:** the same server is wrapped by the production stdio gateway. The
  grader uses `pinpoint_query` only when the gateway emits an artifact.

The direct arm is the correct baseline for boundary disclosure. It is not a claim
about what an LLM would notice, remember, or bill.

## Success criteria

Every paired workflow must meet all applicable conditions:

1. Both processes exit successfully and return the same exact expected answer.
2. An oversized result produces exactly one Pinpoint artifact.
3. No unrelated synthetic canary from an oversized fixture appears in the
   Pinpoint-side data-bearing transcript.
4. Pinpoint data-bearing bytes are at least 90% lower for an oversized workflow.
5. An already-bounded control produces no artifact, preserves its values, and stays
   within 5% of direct response bytes.
6. A retained receipt records package versions, environment, limitations, and source
   fingerprints.

## Phase 1: credential-free protocol matrix

**Executed.** The matrix covers ten workflows, seven pinned published MCP servers,
three Pinpoint query operations, and two passthrough controls:

| Domain | Workflow | Operation | Result |
|---|---|---|---|
| Customer export | Exact row lookup | `json_select` | Pass |
| Customer export | Multi-field count | `count` | Pass |
| Operations | Incident log triage | `grep` | Pass |
| Web research | Long page fact lookup | `grep` | Pass |
| Database analytics | Large SQL result lookup | `json_select` | Pass |
| Knowledge graph | Full-graph node lookup | `json_select` | Pass |
| Knowledge graph | Native bounded node lookup | passthrough | Pass |
| Software delivery | Large commit triage | `grep` | Pass |
| Browser automation | Inline accessibility snapshot | `grep` | Pass |
| Utility | Timezone conversion | passthrough | Pass |

Aggregate data-bearing bytes were 1,259,326 direct and 12,249 with Pinpoint, a
99.0% reduction. All exact answers matched. The eight artifact workflows avoided
11,992 unrelated fixture-canary occurrences. Both passthrough controls emitted zero
artifacts and were byte-identical between arms.

The category selection comes from current official MCP examples, official vendor
servers, and public package/repository adoption signals. It is not an ecosystem-wide
popularity census. See `comparisons/README.md` for sources and the researched but
unexecuted authenticated workflows.

Run with `npm run bench:mcp-common-workflows`. The canonical receipt is
`benchmarks/results/mcp-common-workflows.first-party-macos-arm64-20260716.json`.

## Phase 2: real-host paired runs

**Planned, not executed by this matrix.** Run the same task definitions through at
least two installed MCP hosts. Randomize direct/Pinpoint order and use fresh fixture
variants per repetition. Grade only the host's final answer and retained content-free
telemetry. Require at least 30 paired variants per workflow family before estimating
harm.

Capture:

- exact-answer rate and paired harms;
- host/model/version and tool-call sequence;
- model-visible MCP event bytes and unrelated canaries;
- provider-reported input/output tokens when available;
- wall time, retries, truncation, refusal, and host-side errors;
- observed cost or subscription request accounting.

Use explicit request and spend caps. Do not persist raw provider streams until they
have been reviewed for credentials, personal paths, and non-fixture content.

## Phase 3: authenticated external MCPs

**Planned, blocked on safe test accounts and explicit authorization.** Add GitHub,
Jira/Confluence, Notion, and Slack workflows using disposable organizations and
synthetic data. Continue adding read-heavy observability and cloud-storage workflows
only when a pinned representative can be run safely.
Use synthetic tenants or vendor-provided sandboxes, least-privilege read-only tokens,
and no production data. Candidate shapes are large issue search, pull-request review,
schema/catalog inspection, and trace/log investigation.

Each server is admitted only when both arms can use the same pinned version, query,
fixture or sandbox snapshot, and exact grader. Exclude any service that truncates before
Pinpoint sees the result; record that as a product boundary rather than a failed saving.

## Interpretation

Phase 1 establishes exact protocol behavior for these packages and fixtures. It does
not establish model quality, provider token savings, organic workflow prevalence,
production latency, semantic noninterference, or independent reproduction. Do not
aggregate passthrough controls into a savings headline without showing them separately.