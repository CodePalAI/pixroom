# Find one important change without loading the whole commit

> **Same exact changed line. 98.6% less client-visible response data.**

## The everyday job

A commit adds 2,000 lines. You ask your assistant to find the line associated with
`BUGFIX-0427`.

## Without Pinpoint

The Git MCP's `git_show` tool returns the complete commit. The client receives 1,999
unrelated change markers alongside the line you asked for.

## With Pinpoint

Pinpoint keeps the full commit local. A literal bounded `grep` returns the exact added
line containing the bug-fix marker.

## Result

| Measurement | Direct MCP | With Pinpoint |
|---|---:|---:|
| Correct answer | **Yes** | **Yes** |
| Client-visible response | **96,416 bytes** | **1,384 bytes** |
| Unrelated fixture values visible | **1,999** | **0** |
| Reduction |  | **98.6% less** |

Both arms returned `+export const record1427 = 'BUGFIX-0427 payment retry guard';`.
Pinpoint avoided sending the other 1,999 synthetic markers through the data-bearing
client transcript.

Benchmark case: `git-large-commit-triage`

[Canonical receipt](../benchmarks/results/mcp-common-workflows.first-party-macos-arm64-20260716.json) · [Run the comparison](../benchmarks/REPRODUCING.md#common-mcp-workflow-comparison)

_This is a paired synthetic protocol test. Bytes are MCP response bytes, not model tokens or cost._