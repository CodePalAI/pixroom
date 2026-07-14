import { describe, it, expect } from 'vitest';
import {
  bestEngineByRegret,
  expectedRegret,
  simulateRetrieval,
  mustKeepDensity,
  CONTENT_TYPES,
  ENGINES,
  type QueryKind,
} from '../src/policy/oracle.js';
import type { Rng } from '../src/policy/store.js';

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

describe('retrieval oracle', () => {
  it('produces a genuinely cross-modal winner map (no single engine wins everything)', () => {
    const ratio = 0.4; // ~60% savings — a realistic aggressive operating point
    expect(bestEngineByRegret('prose', ratio)).toBe('semantic');
    expect(bestEngineByRegret('code', ratio)).toBe('semantic');
    expect(bestEngineByRegret('json', ratio)).toBe('optical');
    expect(bestEngineByRegret('log', ratio)).toBe('optical');
  });

  it('is monotincreasing in aggressiveness (more compression ⇒ more regret)', () => {
    for (const engine of ENGINES) {
      for (const ct of CONTENT_TYPES) {
        const aggressive = expectedRegret(engine, ct, 0.2);
        const gentle = expectedRegret(engine, ct, 0.9);
        expect(aggressive).toBeGreaterThanOrEqual(gentle);
      }
    }
  });

  it('samples retrievals whose empirical rate matches the expected regret', () => {
    const rng = mulberry32(12345);
    const engine = 'semantic';
    const ct: (typeof CONTENT_TYPES)[number] = 'prose';
    const ratio = 0.5;
    const n = 20000;
    let hits = 0;
    for (let i = 0; i < n; i++) if (simulateRetrieval(engine, ct, ratio, rng)) hits += 1;
    expect(hits / n).toBeCloseTo(expectedRegret(engine, ct, ratio), 1);
  });

  it('reacts to identifier density in real text', () => {
    const idHeavy = 'ERROR 0xDEADBEEF at /var/log/app.log code=42 pid=13337 --retry';
    const plain = 'the meeting was moved to a later time so everyone could attend it calmly';
    expect(mustKeepDensity(idHeavy)).toBeGreaterThan(mustKeepDensity(plain));
  });

  it('exposes a stable query-kind union for callers', () => {
    const kinds: QueryKind[] = ['id', 'semantic'];
    expect(kinds).toHaveLength(2);
  });
});
