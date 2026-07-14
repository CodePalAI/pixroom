/**
 * Retrieval-regret instrumentation — the modality-agnostic distortion signal.
 *
 * pixroom is the only layer that holds multiple compression modalities (optical =
 * pxpipe, semantic = headroom) behind ONE reversible store and ONE retrieve tool.
 * That lets us attribute a single, uniform signal across engines: when the model
 * calls `headroom_retrieve` on an offloaded original, that retrieval is *regret* —
 * evidence the compression dropped something the model needed. Tagging every
 * offload with its `origin` engine + content type turns each retrieval into a
 * per-(contentType × engine) distortion observation. No single-modality system
 * (headroom or pxpipe alone) can make this cross-modal comparison.
 *
 * A {@link RetrievalRecorder} sees two events:
 *   - `recordOffer`     — an original was offloaded and offered to the model (the
 *                          denominator of regret).
 *   - `recordRetrieval` — the model pulled that original back (the numerator).
 *
 * Recorders MUST be cheap and MUST NOT throw: they run on the hot request/response
 * path and the pipeline never fails closed.
 */

import type { ContentType, Stage } from '../types.js';
import type { PolicyStore } from './store.js';

/** One offload/retrieval observation, attributed to an engine + content type. */
export interface RetrievalEvent {
  /** CCR hash / rec_ id of the offloaded original. */
  readonly id: string;
  /** Engine that produced the offload (the modality being scored). */
  readonly engine: Stage;
  /** Best-effort content class of the offloaded region. */
  readonly contentType: ContentType;
  /** Compression ratio achieved for the region (tokensCompressed / tokensText). */
  readonly ratio?: number;
  /** Stable id of the source region. */
  readonly regionId?: string;
}

/** Sink for offer/retrieval observations. Implementations must not throw. */
export interface RetrievalRecorder {
  /** An original was offloaded and offered to the model (regret denominator). */
  recordOffer(ev: RetrievalEvent): void;
  /** The model retrieved an offloaded original (regret numerator = distortion). */
  recordRetrieval(ev: RetrievalEvent): void;
}

/**
 * In-memory recorder for tests and log-only mode. Keeps raw offer/retrieval counts
 * per (contentType × engine) and the raw event log, and never persists.
 */
export class InMemoryRecorder implements RetrievalRecorder {
  readonly offers: RetrievalEvent[] = [];
  readonly retrievals: RetrievalEvent[] = [];

  recordOffer(ev: RetrievalEvent): void {
    this.offers.push(ev);
  }

  recordRetrieval(ev: RetrievalEvent): void {
    this.retrievals.push(ev);
  }

  /** Observed regret = retrievals / offers for a (contentType, engine) cell. */
  regret(contentType: ContentType, engine: Stage): number {
    const offers = this.offers.filter(
      (e) => e.contentType === contentType && e.engine === engine,
    ).length;
    if (offers === 0) return 0;
    const retr = this.retrievals.filter(
      (e) => e.contentType === contentType && e.engine === engine,
    ).length;
    return retr / offers;
  }
}

/**
 * Recorder that folds observations into a durable {@link PolicyStore}: offers bump
 * the regret denominator (and, via `ratio`, the saved-fraction EWMA), retrievals
 * bump the numerator. This is the recorder wired in when the adaptive path is
 * enabled (or in log-only mode, where `log` narrates without changing routing).
 */
export class StoreBackedRecorder implements RetrievalRecorder {
  constructor(
    private readonly store: PolicyStore,
    private readonly log?: (msg: string) => void,
  ) {}

  recordOffer(ev: RetrievalEvent): void {
    this.store.noteOffer(ev.contentType, ev.engine);
    if (typeof ev.ratio === 'number' && Number.isFinite(ev.ratio)) {
      this.store.noteSaved(ev.contentType, ev.engine, 1 - ev.ratio);
    }
    this.log?.(`offer ${ev.engine}/${ev.contentType} ratio=${ev.ratio?.toFixed(2) ?? '?'}`);
  }

  recordRetrieval(ev: RetrievalEvent): void {
    this.store.noteRetrieval(ev.contentType, ev.engine);
    this.log?.(`retrieval ${ev.engine}/${ev.contentType} id=${ev.id}`);
  }
}
