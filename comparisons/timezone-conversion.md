# When the answer is already small and exact

> **Same exact +9.0h result. Same exact 452-byte response. No artifact created.**

## The everyday job

You ask what time 16:30 UTC is in Tokyo. The official Time MCP performs the timezone
conversion and returns a short structured answer.

## Without Pinpoint

The direct response is already bounded. It contains the source and target timezones,
converted datetime, daylight-saving flags, and the `+9.0h` difference.

## With Pinpoint

Pinpoint passes the response through byte-for-byte. There is no large result to keep
local and no reason to add an artifact query.

## Result

| Measurement | Without Pinpoint | With Pinpoint |
|---|---:|---:|
| Correct answer | **+9.0h** | **+9.0h** |
| Client-visible response | **450 bytes** | **450 bytes** |
| Unrelated fixture values visible | **0** | **0** |
| Artifact created | N/A | **No** |

Pinpoint improved the large-result workflows and left this naturally small utility
response exactly alone.

Benchmark case: `time-zone-conversion-control`

[Canonical receipt](../benchmarks/results/mcp-common-workflows.first-party-macos-arm64-20260716.json) · [Research method](./README.md) · [Run the comparison](../benchmarks/REPRODUCING.md#common-mcp-workflow-comparison)

_This is a paired synthetic protocol test using `mcp-server-time==2026.7.10`. Bytes are MCP response bytes, not model tokens or cost._