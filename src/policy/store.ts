/**
 * Persistent policy store — the memory behind the cross-modal controller.
 *
 * Keyed by (contentType × engine), each cell holds the running evidence the
 * controller needs to make a rate–distortion decision:
 *   - `offers` / `retrievals` → a Beta posterior over **retrieval-regret**
 *     (P(model pulls this back | we offloaded it)) — the distortion estimate.
 *   - `savedEwma`             → the recent mean **saved fraction** for the cell —
 *     the rate estimate.
 * The controller (Phase 2) samples regret (Thompson) and weighs it against saved
 * fraction to pick an engine per region; this file is just the durable evidence.
 *
 * Storage is a single JSON file written atomically (tmp + rename). We deliberately
 * do NOT depend on `node:sqlite` (Node ≥22 only; pixroom targets Node ≥18) or any
 * external driver — zero new runtime dependencies (planning invariant). Loads are
 * tolerant: a missing or corrupt file starts empty rather than throwing, so the
 * pipeline never fails closed on a bad store.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { ContentType, Stage } from '../types.js';

/** Uniform Beta prior — one pseudo-offer, one pseudo-retrieval (regret ≈ 0.5 cold). */
const PRIOR_A = 1;
const PRIOR_B = 1;
/** EWMA smoothing for the saved-fraction estimate. */
const SAVED_EWMA_ALPHA = 0.2;
/** Bumped whenever the on-disk schema changes. */
const STORE_VERSION = 1;

/** Deterministic-injectable RNG for reproducible Thompson sampling in tests. */
export type Rng = () => number;

/** One (contentType × engine) cell of evidence. */
export interface PolicyRecord {
  offers: number;
  retrievals: number;
  /** EWMA of observed saved fraction in [0, 1]; -1 until first observation. */
  savedEwma: number;
  savedN: number;
}

interface StoreFile {
  version: number;
  updatedAt: string;
  records: Record<string, PolicyRecord>;
}

function freshRecord(): PolicyRecord {
  return { offers: 0, retrievals: 0, savedEwma: -1, savedN: 0 };
}

function keyOf(contentType: ContentType, engine: Stage): string {
  return `${contentType}|${engine}`;
}

/**
 * Sample X ~ Gamma(shape, 1) via Marsaglia–Tsang, with the a<1 boost. Used to build
 * Beta samples for Thompson sampling. `rng` returns uniforms in [0, 1).
 */
function sampleGamma(shape: number, rng: Rng): number {
  if (shape < 1) {
    const u = Math.max(rng(), Number.EPSILON);
    return sampleGamma(shape + 1, rng) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      // Box–Muller standard normal from two uniforms.
      const u1 = Math.max(rng(), Number.EPSILON);
      const u2 = rng();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.max(rng(), Number.EPSILON);
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Sample from Beta(a, b) = G(a) / (G(a) + G(b)). */
export function sampleBeta(a: number, b: number, rng: Rng): number {
  const x = sampleGamma(a, rng);
  const y = sampleGamma(b, rng);
  const sum = x + y;
  return sum === 0 ? 0.5 : x / sum;
}

export class PolicyStore {
  private readonly records = new Map<string, PolicyRecord>();
  private dirty = false;

  constructor(private readonly path?: string) {}

  /** Load evidence from disk. Missing/corrupt file ⇒ start empty (never throws). */
  load(): this {
    if (!this.path) return this;
    try {
      const raw = readFileSync(this.path, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoreFile>;
      if (parsed && typeof parsed === 'object' && parsed.records) {
        for (const [k, v] of Object.entries(parsed.records)) {
          if (v && typeof v === 'object') {
            this.records.set(k, {
              offers: Number(v.offers) || 0,
              retrievals: Number(v.retrievals) || 0,
              savedEwma: typeof v.savedEwma === 'number' ? v.savedEwma : -1,
              savedN: Number(v.savedN) || 0,
            });
          }
        }
      }
    } catch {
      // Missing or corrupt ⇒ empty store. Cold-start is a valid state.
    }
    return this;
  }

  private mutable(contentType: ContentType, engine: Stage): PolicyRecord {
    const k = keyOf(contentType, engine);
    let rec = this.records.get(k);
    if (!rec) {
      rec = freshRecord();
      this.records.set(k, rec);
    }
    return rec;
  }

  /** Read-only view of a cell (default record when unseen). */
  get(contentType: ContentType, engine: Stage): PolicyRecord {
    return this.records.get(keyOf(contentType, engine)) ?? freshRecord();
  }

  noteOffer(contentType: ContentType, engine: Stage): void {
    this.mutable(contentType, engine).offers += 1;
    this.dirty = true;
  }

  noteRetrieval(contentType: ContentType, engine: Stage): void {
    this.mutable(contentType, engine).retrievals += 1;
    this.dirty = true;
  }

  /** Fold an observed saved fraction (0..1) into the cell's EWMA. */
  noteSaved(contentType: ContentType, engine: Stage, savedFraction: number): void {
    const rec = this.mutable(contentType, engine);
    const clamped = Math.max(0, Math.min(1, savedFraction));
    rec.savedEwma =
      rec.savedEwma < 0 ? clamped : SAVED_EWMA_ALPHA * clamped + (1 - SAVED_EWMA_ALPHA) * rec.savedEwma;
    rec.savedN += 1;
    this.dirty = true;
  }

  /** Posterior mean regret (distortion) for a cell in [0, 1]. */
  regretMean(contentType: ContentType, engine: Stage): number {
    const r = this.get(contentType, engine);
    const a = PRIOR_A + r.retrievals;
    const b = PRIOR_B + Math.max(0, r.offers - r.retrievals);
    return a / (a + b);
  }

  /** Thompson sample of regret for a cell (drives exploration). */
  regretSample(contentType: ContentType, engine: Stage, rng: Rng = Math.random): number {
    const r = this.get(contentType, engine);
    const a = PRIOR_A + r.retrievals;
    const b = PRIOR_B + Math.max(0, r.offers - r.retrievals);
    return sampleBeta(a, b, rng);
  }

  /** Recent mean saved fraction for a cell, or `fallback` when never observed. */
  savedMean(contentType: ContentType, engine: Stage, fallback = 0): number {
    const r = this.get(contentType, engine);
    return r.savedEwma < 0 ? fallback : r.savedEwma;
  }

  /** Serializable snapshot (for tests / the stats view). */
  snapshot(): StoreFile {
    return {
      version: STORE_VERSION,
      updatedAt: new Date().toISOString(),
      records: Object.fromEntries(this.records),
    };
  }

  /** Persist atomically (tmp + rename). No-op when there is no path or nothing changed. */
  save(): void {
    if (!this.path || !this.dirty) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.snapshot(), null, 2), 'utf8');
      renameSync(tmp, this.path);
      this.dirty = false;
    } catch {
      // A failed write must never break request handling; keep evidence in memory.
    }
  }
}
