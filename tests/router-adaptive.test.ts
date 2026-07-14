import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPixroom } from '../src/pixroom.js';
import { PolicyStore } from '../src/policy/store.js';

const PROSE_SYSTEM = Array.from(
  { length: 40 },
  (_, i) =>
    `You are a careful assistant who explains reasoning clearly and helps the user ` +
    `accomplish their goal in step ${i + 1} with patience, empathy, and good judgment throughout.`,
).join(' ');

function proseRequest(): Record<string, unknown> {
  return {
    model: 'claude-fable-5',
    system: PROSE_SYSTEM,
    messages: [{ role: 'user', content: 'Please help me plan my week.' }],
  };
}

const tmpFiles: string[] = [];
afterEach(() => {
  for (const f of tmpFiles.splice(0)) if (existsSync(f)) rmSync(f, { force: true });
});

describe('ContentRouter adaptive cross-modal control', () => {
  it('keeps today\'s behavior at cold start (optical runs, decision = cold-start)', async () => {
    const px = createPixroom({
      adaptive: { enabled: true },
      semantic: { enabled: false },
      optical: { enabled: true },
    });
    const routed = await px.route('anthropic', 'claude-fable-5', proseRequest(), 'payg');
    expect(routed.adaptive?.slabContentType).toBe('prose');
    expect(routed.adaptive?.decision.engine).toBe('optical');
    expect(routed.adaptive?.decision.source).toBe('cold-start');
    const opticalRow = routed.report.rows.find((r) => r.stage === 'optical');
    // Optical actually ran (was not deferred by the controller).
    expect(opticalRow).toBeDefined();
    await px.shutdown();
  });

  it('defers optical for a slab type it has learned to over-retrieve', async () => {
    const path = join(tmpdir(), `pxr-adaptive-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    tmpFiles.push(path);

    // Pre-seed evidence: optical is bad for prose (high regret, low savings),
    // semantic is well-evidenced and clean.
    const store = new PolicyStore(path).load();
    for (let i = 0; i < 100; i++) store.noteOffer('prose', 'optical');
    for (let i = 0; i < 92; i++) store.noteRetrieval('prose', 'optical');
    store.noteSaved('prose', 'optical', 0.2);
    for (let i = 0; i < 100; i++) store.noteOffer('prose', 'semantic');
    for (let i = 0; i < 3; i++) store.noteRetrieval('prose', 'semantic');
    store.noteSaved('prose', 'semantic', 0.5);
    store.save();

    const px = createPixroom({
      adaptive: { enabled: true, storePath: path },
      semantic: { enabled: false },
      optical: { enabled: true },
    });
    const routed = await px.route('anthropic', 'claude-fable-5', proseRequest(), 'payg');
    expect(routed.adaptive?.decision.engine).toBe('semantic');
    // Deferred ⇒ optical never ran: it reports a pass-through and never claimed the
    // cache_control breakpoint.
    const opticalRow = routed.report.rows.find((r) => r.stage === 'optical');
    expect(opticalRow?.applied).toBe(false);
    expect(opticalRow?.reason).toBe('not_profitable');
    expect(routed.opticalOwnsCacheControl).toBe(false);
    await px.shutdown();
  });

  it('leaves routing untouched when the adaptive path is off (no decision attached)', async () => {
    const px = createPixroom({ semantic: { enabled: false }, optical: { enabled: true } });
    const routed = await px.route('anthropic', 'claude-fable-5', proseRequest(), 'payg');
    expect(routed.adaptive).toBeUndefined();
    await px.shutdown();
  });
});
