/**
 * Proxy response observer — captures retrieval-regret on the primary product surface.
 *
 * The proxy streams upstream responses back to the client untouched. To learn from
 * the model's behavior we tee that stream (bytes pass through unmodified — never
 * fail closed) and, at end-of-response, extract any `headroom_retrieve` tool calls
 * the model made. Each extracted id is a retrieval event: the model pulled back an
 * original pixroom had offloaded, i.e. a distortion observation for that engine.
 *
 * This mirrors headroom's `proxy/handlers/streaming.py`
 * (`_record_ccr_feedback_from_response`) but stays observe-only: we record the
 * signal, we do not (yet) execute the retrieve server-side and continue the
 * conversation. Actually resolving + injecting the original back into the stream is
 * a separate, larger agent-loop feature; recording is all the controller needs.
 *
 * Supports the four shapes pixroom fronts: Anthropic streaming SSE, Anthropic
 * non-stream JSON, OpenAI streaming SSE, and OpenAI non-stream JSON. Every parse is
 * wrapped in try/catch; malformed or oversized bodies are silently skipped.
 */

/** Default cap on buffered response bytes; larger responses skip observation. */
const DEFAULT_MAX_BYTES = 4_000_000;

function asObject(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asArray(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}

/** Pull `data:` payloads out of an SSE body; returns [] when the body is not SSE. */
function parseSseData(raw: string): string[] {
  if (!/(^|\n)\s*data:/.test(raw)) return [];
  const out: string[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (payload.length === 0 || payload === '[DONE]') continue;
    out.push(payload);
  }
  return out;
}

/** Extract `input.id` from an Anthropic streaming tool_use for `toolName`. */
function collectAnthropicEvents(payloads: readonly string[], toolName: string, ids: Set<string>): void {
  const blocks = new Map<number, { isRetrieve: boolean; partial: string }>();
  for (const p of payloads) {
    let obj: Record<string, unknown> | null;
    try {
      obj = asObject(JSON.parse(p));
    } catch {
      continue;
    }
    if (!obj) continue;
    const type = obj.type;
    if (type === 'content_block_start') {
      const idx = Number(obj.index);
      const cb = asObject(obj.content_block);
      if (cb && cb.type === 'tool_use' && cb.name === toolName) {
        blocks.set(idx, { isRetrieve: true, partial: '' });
        const input = asObject(cb.input);
        if (input && typeof input.id === 'string') ids.add(input.id);
      }
    } else if (type === 'content_block_delta') {
      const idx = Number(obj.index);
      const st = blocks.get(idx);
      const delta = asObject(obj.delta);
      if (st?.isRetrieve && delta && delta.type === 'input_json_delta') {
        st.partial += typeof delta.partial_json === 'string' ? delta.partial_json : '';
      }
    } else if (type === 'content_block_stop') {
      const idx = Number(obj.index);
      const st = blocks.get(idx);
      if (st?.isRetrieve) {
        try {
          const input = asObject(JSON.parse(st.partial));
          if (input && typeof input.id === 'string') ids.add(input.id);
        } catch {
          // Incomplete/absent input JSON — nothing to record.
        }
        blocks.delete(idx);
      }
    }
  }
}

/** Extract `arguments.id` from OpenAI streaming tool_calls for `toolName`. */
function collectOpenAiEvents(payloads: readonly string[], toolName: string, ids: Set<string>): void {
  const calls = new Map<number, { name: string; args: string }>();
  for (const p of payloads) {
    let obj: Record<string, unknown> | null;
    try {
      obj = asObject(JSON.parse(p));
    } catch {
      continue;
    }
    const choices = obj && asArray(obj.choices);
    if (!choices) continue;
    for (const choice of choices) {
      const delta = asObject(asObject(choice)?.delta);
      const toolCalls = delta && asArray(delta.tool_calls);
      if (!toolCalls) continue;
      for (const tc of toolCalls) {
        const call = asObject(tc);
        if (!call) continue;
        const idx = Number(call.index ?? 0);
        const fn = asObject(call.function);
        const st = calls.get(idx) ?? { name: '', args: '' };
        if (fn && typeof fn.name === 'string' && fn.name.length > 0) st.name = fn.name;
        if (fn && typeof fn.arguments === 'string') st.args += fn.arguments;
        calls.set(idx, st);
      }
    }
  }
  for (const st of calls.values()) {
    if (st.name !== toolName) continue;
    try {
      const args = asObject(JSON.parse(st.args));
      if (args && typeof args.id === 'string') ids.add(args.id);
    } catch {
      // Ignore incomplete arguments.
    }
  }
}

/** Walk a non-stream response object for tool calls to `toolName`. */
function collectWholeJson(obj: unknown, toolName: string, ids: Set<string>): void {
  const root = asObject(obj);
  if (!root) return;

  // Anthropic Messages: { content: [{ type:'tool_use', name, input:{ id } }] }
  const content = asArray(root.content);
  if (content) {
    for (const block of content) {
      const b = asObject(block);
      if (b && b.type === 'tool_use' && b.name === toolName) {
        const input = asObject(b.input);
        if (input && typeof input.id === 'string') ids.add(input.id);
      }
    }
  }

  // OpenAI Chat Completions: { choices:[{ message:{ tool_calls:[{ function:{ name, arguments } }] }}]}
  const choices = asArray(root.choices);
  if (choices) {
    for (const choice of choices) {
      const message = asObject(asObject(choice)?.message);
      const toolCalls = message && asArray(message.tool_calls);
      if (!toolCalls) continue;
      for (const tc of toolCalls) {
        const fn = asObject(asObject(tc)?.function);
        if (fn && fn.name === toolName && typeof fn.arguments === 'string') {
          try {
            const args = asObject(JSON.parse(fn.arguments));
            if (args && typeof args.id === 'string') ids.add(args.id);
          } catch {
            // Ignore.
          }
        }
      }
    }
  }
}

/**
 * Extract every id the model passed to `toolName` in a full response body (SSE or
 * whole JSON, Anthropic or OpenAI). Order-preserving, de-duplicated. Never throws.
 */
export function extractRetrieveIds(raw: string, toolName: string): string[] {
  const ids = new Set<string>();
  const payloads = parseSseData(raw);
  if (payloads.length > 0) {
    collectAnthropicEvents(payloads, toolName, ids);
    collectOpenAiEvents(payloads, toolName, ids);
  } else {
    try {
      collectWholeJson(JSON.parse(raw), toolName, ids);
    } catch {
      // Not JSON and not SSE — nothing to observe.
    }
  }
  return [...ids];
}

/** A streaming tee that accumulates a response and reports retrieve ids at end. */
export interface RetrieveObserver {
  /** Feed a response chunk (bytes pass through the proxy unmodified elsewhere). */
  push(chunk: Uint8Array | string): void;
  /** Signal end-of-response; parses the buffer and fires `onId` per retrieval. */
  end(): void;
}

/**
 * Create an observe-only tee. Buffers up to `maxBytes` of the response; on `end`
 * it extracts retrieve ids and calls `onId` for each. Oversized responses are
 * skipped rather than buffered unboundedly. `onId` errors are swallowed.
 */
export function createRetrieveObserver(
  toolName: string,
  onId: (id: string) => void,
  opts: { maxBytes?: number } = {},
): RetrieveObserver {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let size = 0;
  let capped = false;
  let ended = false;

  return {
    push(chunk: Uint8Array | string): void {
      if (ended || capped) return;
      const s = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      size += s.length;
      if (size > maxBytes) {
        capped = true;
        chunks.length = 0;
        return;
      }
      chunks.push(s);
    },
    end(): void {
      if (ended) return;
      ended = true;
      if (capped || chunks.length === 0) return;
      const raw = chunks.join('');
      try {
        for (const id of extractRetrieveIds(raw, toolName)) {
          try {
            onId(id);
          } catch {
            // A recorder error must not break response streaming.
          }
        }
      } catch {
        // Never fail closed on a malformed response.
      }
    },
  };
}
