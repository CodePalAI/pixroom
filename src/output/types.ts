import type { Provider } from '../types.js';

export type ResponseEvent =
  | { readonly type: 'text-delta'; readonly text: string }
  | { readonly type: 'thinking-delta'; readonly text: string }
  | {
      readonly type: 'tool-call';
      readonly name: string;
      readonly arguments: string;
      readonly callId?: string;
    }
  | {
      readonly type: 'usage';
      readonly inputTokens?: number;
      readonly outputTokens?: number;
      readonly cacheReadTokens?: number;
      readonly cacheWriteTokens?: number;
    }
  | { readonly type: 'stop'; readonly reason: string }
  | { readonly type: 'error'; readonly message: string }
  | { readonly type: 'response-end' };

export interface OutputEventContext {
  readonly exchangeId: string;
  readonly provider: Provider;
  readonly protocolId?: string;
  readonly pathname: string;
}

export interface OutputIntegration {
  readonly id: string;
  onEvent(event: ResponseEvent, context: OutputEventContext): void | Promise<void>;
}