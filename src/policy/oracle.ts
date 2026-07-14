/**
 * Simulated retrieval oracle — the offline, API-key-free distortion signal.
 *
 * The controller learns from *retrieval-regret*: how often the model pulls an
 * offloaded original back. To characterize the cross-modal rate–distortion frontier
 * and to run a reproducible learning-curve benchmark WITHOUT a live model, we model
 * that behavior with a deterministic, mechanistically-grounded oracle:
 *
 *   "The model retrieves iff the compression dropped something the query needs."
 *
 * The model is parametric, not learned — its value is that it encodes an HONEST,
 * engine-differentiated prior about how the two modalities actually work, so the
 * resulting frontier is meaningful rather than tautological:
 *
 *   - optical (pxpipe images the static slab, keeping a verbatim *factsheet* of
 *     fragile identifiers): near-perfect at returning verbatim ids regardless of
 *     compression ratio, but poor at keeping content "reasoning-accessible" — an
 *     imaged region is pixels, so semantic queries over it distort heavily. Best
 *     for id-heavy reference material the model rarely reasons over (logs, configs).
 *   - semantic (headroom SmartCrusher/Kompress): keeps text readable and
 *     compressible under a must-keep guard: low distortion on the content the model
 *     reasons over (prose, code), moderate id risk only at aggressive ratios. Best
 *     for reasoning-heavy content.
 *
 * These assumptions are stated openly so the eval is honest: they are a simulation,
 * to be replaced by live retrieval events when an API key is available (Phase 3
 * live arm). All functions are pure and deterministic given the injected `rng`.
 */

import type { ContentType, Stage } from '../types.js';
import type { Rng } from './store.js';

/** The two modalities the controller allocates across. */
export const ENGINES: readonly Stage[] = ['optical', 'semantic'];

/** Content classes exercised by the RD-frontier characterization. */
export const CONTENT_TYPES: readonly ContentType[] = ['json', 'code', 'log', 'prose'];

/** A query either needs a verbatim identifier or semantic understanding. */
export type QueryKind = 'id' | 'semantic';

/** Baseline fraction of queries that need a verbatim id, by content type. */
const ID_FRACTION: Record<ContentType, number> = {
  json: 0.6,
  log: 0.8,
  code: 0.3,
  prose: 0.1,
  mixed: 0.5,
  unknown: 0.5,
};

/**
 * Fragile identifiers a compressor must preserve verbatim (hex/UUID, dotted or long
 * numbers, ALLCAPS constants, unix paths, CLI flags, dotted filenames). Mirrors the
 * spirit of headroom's Kompress must-keep guard — used to make the oracle react to
 * the actual density of ids in a region.
 */
const MUST_KEEP_RE =
  /(?:\b0x[0-9a-fA-F]+\b|\b[0-9a-fA-F]{8,}\b|\b\d+(?:\.\d+)+\b|\b\d{3,}\b|\b[A-Z][A-Z0-9_]{2,}\b|(?:\/[\w.-]+){2,}|(?:^|\s)--?[a-zA-Z][\w-]*|\b[\w-]+\.[a-z]{1,4}\b)/g;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Extract fragile identifier tokens from a region. */
export function mustKeepTokens(text: string): string[] {
  return text.match(MUST_KEEP_RE)?.map((s) => s.trim()) ?? [];
}

/** Fraction of "wordish" tokens that are fragile identifiers, in [0, 1]. */
export function mustKeepDensity(text: string): number {
  const words = text.split(/\s+/).filter((w) => w.length > 0).length;
  if (words === 0) return 0;
  return clamp01(mustKeepTokens(text).length / words);
}

/**
 * Fraction of queries needing a verbatim id for a region. Id-dense regions skew
 * toward id-queries (you tend to look things up in a log by their id).
 */
export function idQueryFraction(ct: ContentType, text?: string): number {
  const base = ID_FRACTION[ct] ?? 0.5;
  if (text == null) return base;
  return clamp01(base + 0.4 * mustKeepDensity(text));
}

/**
 * Probability that engine `E` at compression `ratio` (compressed/original; lower =
 * more aggressive) drops what a `kind` query over `ct` needs — i.e. the model must
 * retrieve. See file header for the mechanistic rationale of each branch.
 */
export function dropProbability(
  engine: Stage,
  kind: QueryKind,
  ct: ContentType,
  ratio: number,
): number {
  const aggression = clamp01(1 - ratio);
  if (engine === 'optical') {
    // Factsheet preserves verbatim ids regardless of how hard the slab is imaged.
    if (kind === 'id') return 0.02;
    // Imaged content is not reasoning-accessible; text-native content (prose/code)
    // suffers more than structured (json/log) whose shape survives a glance.
    const base = ct === 'prose' || ct === 'code' ? 0.55 : 0.4;
    return clamp01(0.12 + base * aggression);
  }
  // semantic: text stays readable; must-keep guard protects most ids.
  if (kind === 'id') return clamp01(0.04 + 0.25 * aggression);
  const base = ct === 'prose' ? 0.18 : ct === 'code' ? 0.28 : 0.35;
  return clamp01(base * aggression);
}

/**
 * Expected retrieval-regret for (engine × contentType) at a compression `ratio`,
 * integrating over the query-kind mix for that content type. This is the y-axis of
 * the RD frontier. Deterministic.
 */
export function expectedRegret(
  engine: Stage,
  ct: ContentType,
  ratio: number,
  text?: string,
): number {
  const idf = idQueryFraction(ct, text);
  return (
    idf * dropProbability(engine, 'id', ct, ratio) +
    (1 - idf) * dropProbability(engine, 'semantic', ct, ratio)
  );
}

/**
 * Draw a single retrieval decision for one offloaded region: pick a query kind from
 * the content-type mix, then decide whether the engine dropped what it needed.
 * Deterministic given `rng`. This is the per-event signal the learning loop consumes.
 */
export function simulateRetrieval(
  engine: Stage,
  ct: ContentType,
  ratio: number,
  rng: Rng,
  text?: string,
): boolean {
  const idf = idQueryFraction(ct, text);
  const kind: QueryKind = rng() < idf ? 'id' : 'semantic';
  return rng() < dropProbability(engine, kind, ct, ratio);
}

/** The engine with the lowest expected regret for a content type at a ratio. */
export function bestEngineByRegret(ct: ContentType, ratio: number, text?: string): Stage {
  let best: Stage = 'semantic';
  let bestRegret = Infinity;
  for (const engine of ENGINES) {
    const r = expectedRegret(engine, ct, ratio, text);
    if (r < bestRegret) {
      bestRegret = r;
      best = engine;
    }
  }
  return best;
}
