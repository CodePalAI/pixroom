/**
 * Lightweight content-type classifier for cross-modal rate–distortion attribution.
 *
 * The controller and the retrieval-regret oracle key their statistics on
 * (contentType × engine): "how often does the model retrieve JSON that was imaged
 * vs. JSON that was semantically compressed?" To answer that we need a cheap,
 * dependency-free label for each compressed region. This is a heuristic — it is
 * only ever a bucketing key for learning, never a correctness lever, so a
 * misclassification degrades to a slightly noisier statistic, nothing worse.
 *
 * Mirrors the spirit of headroom's ContentRouter buckets (json / code / log /
 * prose) without importing it (headroom is a sidecar, not a library dependency).
 */

import type { ContentType } from '../types.js';

/** Lines that look like structured log records (level tag or leading timestamp). */
const LOG_LINE_RE =
  /^\s*(?:\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}|\d{2}:\d{2}:\d{2}|(?:ERROR|WARN|WARNING|INFO|DEBUG|TRACE|FATAL)\b)/i;

/** Tokens that strongly signal source code across common languages. */
const CODE_SIGNAL_RE =
  /(?:\bfunction\b|\bconst\b|\blet\b|\bvar\b|\bimport\b|\bexport\b|\bdef\b|\bclass\b|\breturn\b|\bpublic\b|\bprivate\b|=>|::|#include\b|\bfn\b|\bpub\b|\bpackage\b)/;

/** Return true when `s` parses as a JSON object or array. */
function looksLikeJson(s: string): boolean {
  const t = s.trim();
  if (t.length < 2) return false;
  const first = t[0];
  const last = t[t.length - 1];
  const bracketed = (first === '{' && last === '}') || (first === '[' && last === ']');
  if (!bracketed) return false;
  try {
    const parsed: unknown = JSON.parse(t);
    return typeof parsed === 'object' && parsed != null;
  } catch {
    // Not strictly parseable, but strongly JSON-shaped (e.g. truncated tool output).
    const pairs = (t.match(/"[^"]+"\s*:/g) ?? []).length;
    return pairs >= 3;
  }
}

/** Fraction of non-empty lines that match the structured-log pattern. */
function logLineFraction(lines: readonly string[]): number {
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return 0;
  const hits = nonEmpty.filter((l) => LOG_LINE_RE.test(l)).length;
  return hits / nonEmpty.length;
}

/** Ratio of non-alphanumeric, non-space characters — high in code/markup, low in prose. */
function symbolDensity(s: string): number {
  if (s.length === 0) return 0;
  let symbols = 0;
  for (const ch of s) {
    if (!/[\p{L}\p{N}\s]/u.test(ch)) symbols += 1;
  }
  return symbols / s.length;
}

/**
 * Classify a single region of text into a coarse {@link ContentType}. Order of
 * checks matters: JSON and log are the most specific, prose is the default for
 * natural language, code is the fallback for symbol-dense non-JSON text.
 */
export function classifyContent(text: string): ContentType {
  const s = text.trim();
  if (s.length === 0) return 'unknown';

  if (looksLikeJson(s)) return 'json';

  const lines = s.split('\n');
  if (lines.length >= 3 && logLineFraction(lines) >= 0.6) return 'log';

  const density = symbolDensity(s);
  const hasCodeSignal = CODE_SIGNAL_RE.test(s);
  const braces = (s.match(/[{}();]/g) ?? []).length;
  const bracePerLine = braces / Math.max(1, lines.length);

  // Prose: mostly words and sentences, low symbol density, no strong code signal.
  if (density < 0.12 && !(hasCodeSignal && bracePerLine > 0.5)) return 'prose';

  // Code: strong code signal, or symbol/brace dense without reading as prose.
  if (hasCodeSignal || bracePerLine > 0.8 || density >= 0.2) return 'code';

  return 'prose';
}

/**
 * Pick one {@link ContentType} for a set of regions, weighting by length. Used when
 * an engine offloads several regions in one request but the reversible handles are
 * opaque (headroom CCR hashes): we attribute them to the dominant content type of
 * the semantic region. Returns `mixed` when no single type owns a clear majority.
 */
export function dominantContentType(texts: readonly string[]): ContentType {
  if (texts.length === 0) return 'unknown';
  const chars = new Map<ContentType, number>();
  let total = 0;
  for (const t of texts) {
    const ct = classifyContent(t);
    const len = t.length;
    chars.set(ct, (chars.get(ct) ?? 0) + len);
    total += len;
  }
  if (total === 0) return 'unknown';

  let best: ContentType = 'unknown';
  let bestChars = -1;
  for (const [ct, n] of chars) {
    if (n > bestChars) {
      best = ct;
      bestChars = n;
    }
  }
  // No clear majority ⇒ report the region as mixed rather than over-claiming a type.
  if (bestChars / total < 0.6 && chars.size > 1) return 'mixed';
  return best;
}
