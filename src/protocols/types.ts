import type { Provider } from '../types.js';

export interface ProtocolMatchInput {
  readonly method: string | undefined;
  readonly pathname: string;
}

/** Request-wire adapter. Unknown fields must survive decode/encode unchanged. */
export interface ProtocolAdapter {
  readonly id: string;
  readonly provider: Provider;
  matches(input: ProtocolMatchInput): boolean;
  decodeRequest(bytes: Uint8Array): Record<string, unknown>;
  validateRequest(body: Readonly<Record<string, unknown>>): void;
  encodeRequest(body: Readonly<Record<string, unknown>>): Uint8Array;
}