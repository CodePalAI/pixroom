import { describe, it, expect } from 'vitest';
import { extractRetrieveIds, createRetrieveObserver } from '../src/proxy/response-observer.js';

const TOOL = 'headroom_retrieve';

/** Render one Anthropic SSE event. */
function sse(obj: Record<string, unknown>): string {
  return `event: ${String(obj.type)}\ndata: ${JSON.stringify(obj)}\n\n`;
}

describe('extractRetrieveIds', () => {
  it('reads Anthropic streaming tool_use input (fragmented JSON)', () => {
    const raw =
      sse({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_1', name: TOOL, input: {} },
      }) +
      sse({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"id":"' },
      }) +
      sse({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: 'rec_42"}' },
      }) +
      sse({ type: 'content_block_stop', index: 0 });
    expect(extractRetrieveIds(raw, TOOL)).toEqual(['rec_42']);
  });

  it('reads Anthropic non-stream JSON tool_use', () => {
    const raw = JSON.stringify({
      content: [
        { type: 'text', text: 'let me look' },
        { type: 'tool_use', name: TOOL, input: { id: 'h9' } },
      ],
    });
    expect(extractRetrieveIds(raw, TOOL)).toEqual(['h9']);
  });

  it('reads OpenAI streaming tool_calls (fragmented arguments)', () => {
    const raw =
      `data: ${JSON.stringify({
        choices: [
          { delta: { tool_calls: [{ index: 0, function: { name: TOOL, arguments: '{"id":' } }] } },
        ],
      })}\n\n` +
      `data: ${JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"abc"}' } }] } }],
      })}\n\n` +
      'data: [DONE]\n\n';
    expect(extractRetrieveIds(raw, TOOL)).toEqual(['abc']);
  });

  it('reads OpenAI non-stream tool_calls', () => {
    const raw = JSON.stringify({
      choices: [
        { message: { tool_calls: [{ function: { name: TOOL, arguments: '{"id":"z"}' } }] } },
      ],
    });
    expect(extractRetrieveIds(raw, TOOL)).toEqual(['z']);
  });

  it('ignores tool calls to other tools and malformed bodies', () => {
    const other = JSON.stringify({
      content: [{ type: 'tool_use', name: 'some_other_tool', input: { id: 'nope' } }],
    });
    expect(extractRetrieveIds(other, TOOL)).toEqual([]);
    expect(extractRetrieveIds('not json and not sse', TOOL)).toEqual([]);
    expect(extractRetrieveIds('', TOOL)).toEqual([]);
  });
});

describe('createRetrieveObserver', () => {
  it('collects ids across chunk boundaries and reports on end', () => {
    const raw =
      sse({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_1', name: TOOL, input: {} },
      }) +
      sse({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"id":"rec_7"}' },
      }) +
      sse({ type: 'content_block_stop', index: 0 });

    const got: string[] = [];
    const observer = createRetrieveObserver(TOOL, (id) => got.push(id));
    const mid = Math.floor(raw.length / 2);
    observer.push(new TextEncoder().encode(raw.slice(0, mid)));
    observer.push(new TextEncoder().encode(raw.slice(mid)));
    observer.end();
    expect(got).toEqual(['rec_7']);
  });

  it('skips oversized responses without firing', () => {
    const got: string[] = [];
    const observer = createRetrieveObserver(TOOL, (id) => got.push(id), { maxBytes: 8 });
    observer.push('x'.repeat(64));
    observer.end();
    expect(got).toEqual([]);
  });
});
