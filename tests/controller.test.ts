import { describe, it, expect } from 'vitest';
import { PolicyStore, type Rng } from '../src/policy/store.js';
import {
  CrossModalController,
  DEFAULT_CONTROLLER_CONFIG,
  type ControllerConfig,
} from '../src/policy/controller.js';
import type { ContentType, Stage } from '../src/types.js';

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seed(
  store: PolicyStore,
  ct: ContentType,
  engine: Stage,
  offers: number,
  retrievals: number,
  saved: number,
): void {
  for (let i = 0; i < offers; i++) store.noteOffer(ct, engine);
  for (let i = 0; i < retrievals; i++) store.noteRetrieval(ct, engine);
  store.noteSaved(ct, engine, saved);
}

const cfg = (o: Partial<ControllerConfig> = {}): ControllerConfig => ({
  ...DEFAULT_CONTROLLER_CONFIG,
  ...o,
});

describe('CrossModalController', () => {
  it('returns the default engine at cold start (matches static routing)', () => {
    const store = new PolicyStore();
    const c = new CrossModalController(store, cfg(), mulberry32(1));
    const d = c.chooseEngine({ contentType: 'json', eligible: ['optical', 'semantic'], defaultEngine: 'optical' });
    expect(d.engine).toBe('optical');
    expect(d.source).toBe('cold-start');
  });

  it('returns the only eligible engine without consulting the store', () => {
    const store = new PolicyStore();
    const c = new CrossModalController(store, cfg(), mulberry32(1));
    const d = c.chooseEngine({ contentType: 'prose', eligible: ['semantic'], defaultEngine: 'optical' });
    expect(d.engine).toBe('semantic');
    expect(d.source).toBe('single');
  });

  it('overrides the default when a well-evidenced engine has higher utility', () => {
    const store = new PolicyStore();
    // Default optical is bad for json here (high regret, low savings)…
    seed(store, 'json', 'optical', 100, 90, 0.2);
    // …semantic is well-evidenced with low regret and good savings.
    seed(store, 'json', 'semantic', 100, 4, 0.5);
    const c = new CrossModalController(store, cfg(), mulberry32(7));
    const d = c.chooseEngine({ contentType: 'json', eligible: ['optical', 'semantic'], defaultEngine: 'optical' });
    expect(d.engine).toBe('semantic');
    expect(d.source).toBe('exploit');
  });

  it('does NOT override the default until the alternative clears the evidence bar', () => {
    const store = new PolicyStore();
    seed(store, 'json', 'optical', 10, 9, 0.2); // default, bad but incumbent
    seed(store, 'json', 'semantic', 3, 0, 0.9); // great but under-evidenced (< minOffers=8)
    const c = new CrossModalController(store, cfg(), mulberry32(7));
    const d = c.chooseEngine({ contentType: 'json', eligible: ['optical', 'semantic'], defaultEngine: 'optical' });
    expect(d.engine).toBe('optical');
  });

  it('is session-stable and re-decides only after reset', () => {
    const store = new PolicyStore();
    const c = new CrossModalController(store, cfg(), mulberry32(3));
    // Cold start caches optical for prose.
    expect(c.chooseEngine({ contentType: 'prose', eligible: ['optical', 'semantic'], defaultEngine: 'optical' }).engine).toBe(
      'optical',
    );
    // Now semantic becomes clearly better, but the session decision is cached.
    seed(store, 'prose', 'optical', 100, 95, 0.2);
    seed(store, 'prose', 'semantic', 100, 3, 0.6);
    expect(c.chooseEngine({ contentType: 'prose', eligible: ['optical', 'semantic'], defaultEngine: 'optical' }).engine).toBe(
      'optical',
    );
    // A new session re-decides on the accumulated evidence.
    c.reset();
    expect(c.chooseEngine({ contentType: 'prose', eligible: ['optical', 'semantic'], defaultEngine: 'optical' }).engine).toBe(
      'semantic',
    );
  });
});
