# Recall one customer note without opening the whole graph

> **Same exact note. 98.9% less client-visible response data.**

## The everyday job

Your memory MCP contains 500 customer entities. You ask for the observation attached
to `customer-0311`.

## Without Pinpoint

The Memory MCP's `read_graph` tool returns the complete graph. The client receives
every entity and observation before selecting one note.

## With Pinpoint

Pinpoint recognizes the graph's structured entity collection, keeps it local, and
returns only the `observations` field for the named customer.

## Result

| Measurement | Direct MCP | With Pinpoint |
|---|---:|---:|
| Correct answer | **Yes** | **Yes** |
| Client-visible response | **132,672 bytes** | **1,495 bytes** |
| Unrelated fixture values visible | **998** | **0** |
| Reduction |  | **98.9% less** |

Both arms returned `memory-private-0311`. The other synthetic customer names and
observations stayed out of the Pinpoint-side data-bearing transcript.

Benchmark case: `memory-knowledge-graph-lookup`

[Canonical receipt](../benchmarks/results/mcp-common-workflows.first-party-macos-arm64-20260716.json) · [Run the comparison](../benchmarks/REPRODUCING.md#common-mcp-workflow-comparison)

_This is a paired synthetic protocol test. Bytes are MCP response bytes, not model tokens or cost._