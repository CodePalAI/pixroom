# Find one incident without pouring the whole log into the chat

> **Same exact incident line. 99.5% less client-visible response data.**

## The everyday job

A service has a 2,000-line log. You ask your assistant to find incident
`INCIDENT-0427` so you can see what failed.

## Without Pinpoint

The filesystem MCP server returns the entire log. The client receives 1,999
unrelated log markers alongside the one incident line you need.

## With Pinpoint

Pinpoint keeps the log local. A literal bounded `grep` retrieves the line containing
the incident ID, including its timestamp and error message.

## Result

| Measurement | Direct MCP | With Pinpoint |
|---|---:|---:|
| Correct answer | **Yes** | **Yes** |
| Client-visible response | **276,180 bytes** | **1,490 bytes** |
| Unrelated fixture values visible | **1,999** | **0** |
| Reduction |  | **99.5% less** |

Both arms returned the same exact line: payment authorization timed out. Pinpoint
found it without sending the other 1,999 synthetic log markers through the client
transcript.

Benchmark case: `filesystem-incident-log-triage`

[Canonical receipt](../benchmarks/results/mcp-common-workflows.first-party-macos-arm64-20260716.json) · [Run the comparison](../benchmarks/REPRODUCING.md#common-mcp-workflow-comparison)

_This is a paired synthetic protocol test. Bytes are MCP response bytes, not model tokens or cost._