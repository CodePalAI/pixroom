import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PolicyStore, sampleBeta, type Rng } from '../src/policy/store.js';
import { StoreBackedRecorder } from '../src/policy/retrieval-recorder.js';

/** Deterministic PRNG for reproducible Beta sampling. */
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

const tmpFiles: string[] = [];
afterEach(() => {
  for (const f of tmpFiles.splice(0)) if (existsSync(f)) rmSync(f, { force: true });
});

describe('PolicyStore', () => {
  it('estimates regret from offers and retrievals with a uniform prior', () => {
    const store = new PolicyStore();
    for (let i = 0; i < 4; i++) store.noteOffer('json', 'semantic');
    store.noteRetrieval('json', 'semantic');
    // Beta(1+1, 1+3) mean = 2/6.
    expect(store.regretMean('json', 'semantic')).toBeCloseTo(2 / 6, 6);
    // Unseen cell falls back to the uniform prior mean 0.5.
    expect(store.regretMean('code', 'optical')).toBeCloseTo(0.5, 6);
  });

  it('tracks a saved-fraction EWMA', () => {
    const store = new PolicyStore();
    store.noteSaved('prose', 'optical', 0.4);
    store.noteSaved('prose', 'optical', 0.9); // 0.2*0.9 + 0.8*0.4 = 0.5
    expect(store.savedMean('prose', 'optical')).toBeCloseTo(0.5, 6);
    expect(store.savedMean('prose', 'semantic', 0.123)).toBeCloseTo(0.123, 6);
  });

  it('persists and reloads evidence atomically', () => {
    const path = join(tmpdir(), `pxr-policy-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    tmpFiles.push(path);
    const store = new PolicyStore(path).load();
    for (let i = 0; i < 5; i++) store.noteOffer('log', 'semantic');
    store.noteRetrieval('log', 'semantic');
    store.noteRetrieval('log', 'semantic');
    store.save();
    expect(existsSync(path)).toBe(true);

    const reloaded = new PolicyStore(path).load();
    expect(reloaded.get('log', 'semantic').offers).toBe(5);
    expect(reloaded.get('log', 'semantic').retrievals).toBe(2);
    expect(reloaded.regretMean('log', 'semantic')).toBeCloseTo(store.regretMean('log', 'semantic'), 9);
  });

  it('tolerates a missing store file (cold start)', () => {
    const store = new PolicyStore(join(tmpdir(), 'pxr-does-not-exist-xyz.json')).load();
    expect(store.get('json', 'optical').offers).toBe(0);
  });

  it('samples Beta deterministically within [0,1)', () => {
    const a = sampleBeta(3, 5, mulberry32(1));
    const b = sampleBeta(3, 5, mulberry32(1));
    expect(a).toBe(b); // same seed ⇒ same draw
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
  });
});

describe('StoreBackedRecorder', () => {
  it('folds offers (with ratio) and retrievals into the store', () => {
    const store = new PolicyStore();
    const rec = new StoreBackedRecorder(store);
    rec.recordOffer({ id: 'a', engine: 'optical', contentType: 'code', ratio: 0.25 });
    rec.recordOffer({ id: 'b', engine: 'optical', contentType: 'code', ratio: 0.25 });
    rec.recordRetrieval({ id: 'a', engine: 'optical', contentType: 'code' });

    expect(store.get('code', 'optical').offers).toBe(2);
    expect(store.get('code', 'optical').retrievals).toBe(1);
    // savedFraction = 1 - ratio = 0.75.
    expect(store.savedMean('code', 'optical')).toBeCloseTo(0.75, 6);
  });
});
