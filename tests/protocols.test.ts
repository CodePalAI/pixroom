import { describe, expect, it } from 'vitest';

import { createBuiltinProtocolRegistry } from '../src/protocols/json.js';
import { ProtocolRegistry } from '../src/protocols/registry.js';

describe('ProtocolRegistry', () => {
  it('matches Anthropic, OpenAI Chat, and Responses aliases', () => {
    const registry = createBuiltinProtocolRegistry();
    expect(registry.match({ method: 'POST', pathname: '/v1/messages' })?.id).toBe(
      'anthropic.messages',
    );
    expect(registry.match({ method: 'POST', pathname: '/v1/chat/completions' })?.id).toBe(
      'openai.chat-completions',
    );
    expect(registry.match({ method: 'POST', pathname: '/backend-api/codex/responses' })?.id).toBe(
      'openai.responses',
    );
  });

  it('does not match count_tokens, response subresources, or non-POST requests', () => {
    const registry = createBuiltinProtocolRegistry();
    expect(registry.match({ method: 'POST', pathname: '/v1/messages/count_tokens' })).toBeUndefined();
    expect(registry.match({ method: 'POST', pathname: '/v1/responses/resp_1' })).toBeUndefined();
    expect(registry.match({ method: 'GET', pathname: '/v1/responses' })).toBeUndefined();
  });

  it('validates protocol-specific shape while preserving unknown fields', () => {
    const registry = createBuiltinProtocolRegistry();
    const adapter = registry.match({ method: 'POST', pathname: '/v1/responses' })!;
    const bytes = new TextEncoder().encode(
      JSON.stringify({ model: 'gpt-5', input: 'hello', vendor_extension: { x: 1 } }),
    );
    const decoded = adapter.decodeRequest(bytes);
    adapter.validateRequest(decoded);
    expect(JSON.parse(new TextDecoder().decode(adapter.encodeRequest(decoded)))).toEqual({
      model: 'gpt-5',
      input: 'hello',
      vendor_extension: { x: 1 },
    });
    expect(() => adapter.validateRequest({ model: 'gpt-5' })).toThrow(
      'input must be a string or array',
    );
  });

  it('rejects duplicate protocol ids', () => {
    const first = createBuiltinProtocolRegistry().list()[0]!;
    const registry = new ProtocolRegistry().register(first);
    expect(() => registry.register(first)).toThrow('duplicate protocol id: anthropic.messages');
  });
});