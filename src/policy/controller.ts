/**
 * Cross-modal controller — the novel online policy.
 *
 * Given a region's content type and the engines the gates allow, it chooses which
 * modality should own that region, maximizing expected utility
 *
 *     U(engine) = E[saved fraction] − E[retrieval-regret]
 *
 * which is EXACTLY the expected net token saving under the retrieval cost model: a
 * region not retrieved saves its `savedFraction`; a retrieved region costs the
 * wasted compressed copy (−ratio), and the algebra collapses to `saved − regret`
 * (see benchmarks/adaptive.mjs). Both terms come from the persistent
 * {@link PolicyStore}. This is what turns pixroom from "two fixed engines on
 * disjoint regions" into a system that LEARNS the per-content-type modality
 * allocation from the model's own behavior — the cross-modal decision
 * headroom/pxpipe cannot make alone.
 *
 * Design guarantees (planning invariants):
 *   - **Cold-start == today.** With no evidence for a content type, it returns the
 *     region's static `defaultEngine`, so an un-warmed controller reproduces the
 *     current fixed routing exactly.
 *   - **Bounded cold harm.** A non-default engine may only WIN by exploitation once
 *     it has ≥ `minOffers` observations; before that the default stands.
 *   - **Cache-safety.** With `sessionStable`, the decision per content type is
 *     computed once and reused for the session, so routing does not flip per request
 *     and bust prompt caches. Exploration happens ACROSS sessions (fresh process ⇒
 *     fresh exploration draws), not within one.
 *   - **ε-greedy** over the regret posterior: it exploits the posterior MEAN utility
 *     and explores uniformly at rate `exploreRate`. (Thompson sampling is available
 *     via {@link PolicyStore.regretSample} as a schedule-free alternative.) `rng` is
 *     injectable for reproducibility.
 */

import type { ContentType, Stage } from '../types.js';
import type { PolicyStore, Rng } from './store.js';

export interface ControllerConfig {
  /** ε for uniform random exploration (0 disables; exploitation is already stochastic). */
  readonly exploreRate: number;
  /** Observations a non-default engine needs before it may win by exploitation. */
  readonly minOffers: number;
  /** Cache one decision per content type for the session (prompt-cache safety). */
  readonly sessionStable: boolean;
}

export const DEFAULT_CONTROLLER_CONFIG: ControllerConfig = {
  exploreRate: 0,
  minOffers: 8,
  sessionStable: true,
};

export interface ChooseInput {
  readonly contentType: ContentType;
  /** Engines allowed by the gates (auth mode, model scope, sidecar availability). */
  readonly eligible: readonly Stage[];
  /** Today's static engine for this region — the cold-start / bounded-harm anchor. */
  readonly defaultEngine: Stage;
  /** Prior saved fraction per engine when a cell has no saved-fraction history yet. */
  readonly fallbackSaved?: Partial<Record<Stage, number>>;
}

export interface EngineDecision {
  readonly engine: Stage;
  readonly source: 'single' | 'cold-start' | 'exploit' | 'explore';
  readonly utilities: Partial<Record<Stage, number>>;
}

export class CrossModalController {
  private readonly cache = new Map<ContentType, Stage>();

  constructor(
    private readonly store: PolicyStore,
    private readonly cfg: ControllerConfig = DEFAULT_CONTROLLER_CONFIG,
    private readonly rng: Rng = Math.random,
    private readonly log?: (msg: string) => void,
  ) {}

  /** Clear the session decision cache (start of a new session). */
  reset(): void {
    this.cache.clear();
  }

  /** Choose the engine that should own a region of `contentType`. */
  chooseEngine(input: ChooseInput): EngineDecision {
    const eligible = input.eligible.length > 0 ? input.eligible : [input.defaultEngine];
    if (eligible.length === 1) {
      return { engine: eligible[0] ?? input.defaultEngine, source: 'single', utilities: {} };
    }

    if (this.cfg.sessionStable) {
      const cached = this.cache.get(input.contentType);
      if (cached && eligible.includes(cached)) {
        return { engine: cached, source: 'exploit', utilities: {} };
      }
    }

    let decision: EngineDecision;
    if (this.cfg.exploreRate > 0 && this.rng() < this.cfg.exploreRate) {
      const pick = eligible[Math.floor(this.rng() * eligible.length)] ?? input.defaultEngine;
      decision = { engine: pick, source: 'explore', utilities: {} };
    } else {
      decision = this.exploit(input, eligible);
    }

    if (this.cfg.sessionStable) this.cache.set(input.contentType, decision.engine);
    this.log?.(
      `route ${input.contentType} → ${decision.engine} (${decision.source})` +
        (Object.keys(decision.utilities).length
          ? ` U={${Object.entries(decision.utilities)
              .map(([e, u]) => `${e}:${u?.toFixed(3)}`)
              .join(' ')}}`
          : ''),
    );
    return decision;
  }

  private exploit(input: ChooseInput, eligible: readonly Stage[]): EngineDecision {
    const { contentType, defaultEngine, fallbackSaved } = input;
    const anyData = eligible.some((e) => this.store.get(contentType, e).offers > 0);
    if (!anyData) return { engine: defaultEngine, source: 'cold-start', utilities: {} };

    const utilities: Partial<Record<Stage, number>> = {};
    let best = defaultEngine;
    let bestUtility = -Infinity;
    for (const engine of eligible) {
      const rec = this.store.get(contentType, engine);
      const saved = this.store.savedMean(contentType, engine, fallbackSaved?.[engine] ?? 0.5);
      const regret = this.store.regretMean(contentType, engine);
      // Expected net token saving = saved − regret (retrieval wastes the compressed copy).
      const utility = saved - regret;
      utilities[engine] = utility;
      // A non-default engine must clear the evidence bar before it can win.
      const mayWin = engine === defaultEngine || rec.offers >= this.cfg.minOffers;
      if (mayWin && utility > bestUtility) {
        bestUtility = utility;
        best = engine;
      }
    }
    return { engine: best, source: 'exploit', utilities };
  }
}
