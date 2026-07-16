# When the MCP already gives you exactly what you asked for

> **Same exact note. Same exact 437-byte response. No artifact created.**

## The everyday job

You ask the Memory MCP for one named customer through its native `open_nodes` tool.
The server already knows how to return a small, focused result.

## Without Pinpoint

The direct MCP response contains the requested customer and note. It is already
bounded, so there is nothing useful to trim.

## With Pinpoint

Pinpoint sees that the result is small and passes it through. It does not create an
artifact, add a query round, or claim savings that are not there.

## Result

| Measurement | Direct MCP | With Pinpoint |
|---|---:|---:|
| Correct answer | **Yes** | **Yes** |
| Client-visible response | **437 bytes** | **437 bytes** |
| Unrelated fixture values visible | **0** | **0** |
| Artifact created | N/A | **No** |

This control matters: Pinpoint improved the oversized workflows and left the good
native workflow byte-for-byte alone.

Benchmark case: `memory-native-node-lookup-control`

[Canonical receipt](../benchmarks/results/mcp-common-workflows.first-party-macos-arm64-20260716.json) · [Run the comparison](../benchmarks/REPRODUCING.md#common-mcp-workflow-comparison)

_This is a paired synthetic protocol test. Bytes are MCP response bytes, not model tokens or cost._