# pixroom

A context-compression layer for AI agents that combines two complementary
approaches to cutting LLM token usage:

- **[pxpipe](https://github.com/teamchong/pxpipe)** — *pixel* compression:
  renders bulky text context (system prompt, tool docs, history) as compact
  PNG images, since an image's token cost is fixed by its pixel dimensions
  rather than the amount of text inside it.
- **[headroom](https://github.com/headroomlabs-ai/headroom)** — *semantic*
  compression: content-aware compressors for tool outputs, logs, RAG chunks,
  files, and conversation history before they reach the model.

The name is a portmanteau of **pix** (pxpipe) + **room** (headroom).

## Status

Early scaffolding. The two upstream projects are cloned as siblings of this
directory for reference:

```
repos-pixroom/
├── headroom/   # cloned OSS (Apache-2.0)
├── pxpipe/     # cloned OSS (MIT)
└── pixroom/    # this project
```
