import type { CcrStore } from '../ccr/store.js';
import type { OutputEventContext, OutputIntegration, ResponseEvent } from './types.js';

/** Records model-initiated CCR retrievals from normalized tool-call events. */
export class CcrRetrievalOutputIntegration implements OutputIntegration {
  readonly id = 'pixroom.ccr-retrieval';
  private readonly seen = new Map<string, Set<string>>();

  constructor(private readonly ccr: CcrStore) {}

  onEvent(event: ResponseEvent, context: OutputEventContext): void {
    if (event.type === 'response-end') {
      this.seen.delete(context.exchangeId);
      return;
    }
    if (event.type !== 'tool-call' || event.name !== 'headroom_retrieve') return;

    try {
      const args = JSON.parse(event.arguments) as { id?: unknown };
      if (typeof args.id !== 'string') return;
      let ids = this.seen.get(context.exchangeId);
      if (!ids) {
        ids = new Set<string>();
        this.seen.set(context.exchangeId, ids);
      }
      if (ids.has(args.id)) return;
      ids.add(args.id);
      this.ccr.noteRetrieved(args.id);
    } catch {
      // Incomplete/malformed arguments are not a retrieval observation.
    }
  }
}