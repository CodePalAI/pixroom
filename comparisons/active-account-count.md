# Count the right accounts without sending the account list

> **Same exact count: 166. 99.4% less client-visible response data.**

## The everyday job

You need a quick answer: how many active accounts are in the EU region? The source
is a 1,000-row customer export.

## Without Pinpoint

The filesystem MCP server sends the full export to the client. The client receives
every customer email and account row just to calculate one number.

## With Pinpoint

Pinpoint keeps the export local and applies the exact filters `active: true` and
`region: eu-west`. Only the count comes back through the bounded query response.

## Result

| Measurement | Direct MCP | With Pinpoint |
|---|---:|---:|
| Correct answer | **166** | **166** |
| Client-visible response | **215,336 bytes** | **1,307 bytes** |
| Unrelated fixture values visible | **1,000** | **0** |
| Reduction |  | **99.4% less** |

The answer stayed exact. The 1,000 customer emails did not need to enter the
Pinpoint-side data-bearing transcript to produce it.

Benchmark case: `filesystem-filtered-count`

[Canonical receipt](../benchmarks/results/mcp-common-workflows.first-party-macos-arm64-20260716.json) · [Run the comparison](../benchmarks/REPRODUCING.md#common-mcp-workflow-comparison)

_This is a paired synthetic protocol test. Bytes are MCP response bytes, not model tokens or cost._