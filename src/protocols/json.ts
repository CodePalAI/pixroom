import { parseBody, serializeBody } from '../anthropic.js';
import type { Provider } from '../types.js';
import { ProtocolRegistry } from './registry.js';
import type { ProtocolAdapter, ProtocolMatchInput } from './types.js';

type RequestValidator = (body: Readonly<Record<string, unknown>>) => void;

class JsonProtocolAdapter implements ProtocolAdapter {
  constructor(
    readonly id: string,
    readonly provider: Provider,
    private readonly matchPath: (pathname: string) => boolean,
    private readonly validator: RequestValidator,
  ) {}

  matches(input: ProtocolMatchInput): boolean {
    return input.method === 'POST' && this.matchPath(input.pathname);
  }

  decodeRequest(bytes: Uint8Array): Record<string, unknown> {
    return parseBody(bytes);
  }

  validateRequest(body: Readonly<Record<string, unknown>>): void {
    this.validator(body);
  }

  encodeRequest(body: Readonly<Record<string, unknown>>): Uint8Array {
    return serializeBody(body as Record<string, unknown>);
  }
}

function requireArray(body: Readonly<Record<string, unknown>>, field: string): void {
  if (!Array.isArray(body[field])) throw new Error(`${field} must be an array`);
}

export function createBuiltinProtocolRegistry(): ProtocolRegistry {
  return new ProtocolRegistry()
    .register(
      new JsonProtocolAdapter(
        'anthropic.messages',
        'anthropic',
        (path) => !path.includes('count_tokens') && path.endsWith('/messages'),
        (body) => requireArray(body, 'messages'),
      ),
    )
    .register(
      new JsonProtocolAdapter(
        'openai.chat-completions',
        'openai',
        (path) => path.endsWith('/chat/completions'),
        (body) => requireArray(body, 'messages'),
      ),
    )
    .register(
      new JsonProtocolAdapter(
        'openai.responses',
        'openai',
        (path) => path.endsWith('/responses'),
        (body) => {
          if (typeof body.input !== 'string' && !Array.isArray(body.input)) {
            throw new Error('input must be a string or array');
          }
        },
      ),
    );
}