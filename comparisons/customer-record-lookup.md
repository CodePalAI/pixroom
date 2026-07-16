# Find one customer without loading every customer

> **Same exact email. 99.3% less client-visible response data.**

## The everyday job

You have an export with 1,000 customer accounts. You ask your assistant for the
email address attached to account 733.

## Without Pinpoint

The filesystem MCP server returns the complete export. The client receives all
1,000 rows so it can find one email address. That includes 999 unrelated customer
emails that the task never asked for.

## With Pinpoint

Pinpoint keeps the export local and returns a compact artifact handle. The client
asks for `accountId: 733` and the `email` field. Pinpoint returns the exact value
from the original export.

## Result

| Measurement | Direct MCP | With Pinpoint |
|---|---:|---:|
| Correct answer | **Yes** | **Yes** |
| Client-visible response | **215,336 bytes** | **1,463 bytes** |
| Unrelated fixture values visible | **999** | **0** |
| Reduction |  | **99.3% less** |

Pinpoint returned `workflow-user-733@example.invalid` in both arms. It did not
summarize or guess. It selected one exact field while the rest of the export stayed
out of the data-bearing client transcript.

Benchmark case: `filesystem-exact-record-lookup`

[Canonical receipt](../benchmarks/results/mcp-common-workflows.first-party-macos-arm64-20260716.json) · [Run the comparison](../benchmarks/REPRODUCING.md#common-mcp-workflow-comparison)

_This is a paired synthetic protocol test. Bytes are MCP response bytes, not model tokens or cost._