import { describe, it, expect } from 'vitest';
import { CcrStore } from '../src/ccr/store.js';
import { InMemoryRecorder } from '../src/policy/retrieval-recorder.js';
import type { ReversibleHandle } from '../src/types.js';

describe('CcrStore retrieval-regret instrumentation', () => {
  it('records an offer per registered handle with engine + content type', () => {
    const rec = new InMemoryRecorder();
    const store = new CcrStore(undefined, rec);
    const handles: ReversibleHandle[] = [
      { id: 'rec_1', origin: 'optical', original: 'SLAB', contentType: 'code', ratio: 0.3 },
      { id: 'h1', origin: 'semantic', contentType: 'json', ratio: 0.5 },
    ];
    store.registerReversible(handles);

    expect(rec.offers).toHaveLength(2);
    expect(rec.offers.find((o) => o.id === 'rec_1')?.engine).toBe('optical');
    expect(rec.offers.find((o) => o.id === 'rec_1')?.contentType).toBe('code');
    expect(rec.offers.find((o) => o.id === 'h1')?.engine).toBe('semantic');
  });

  it('records a retrieval when an inline original is pulled back', async () => {
    const rec = new InMemoryRecorder();
    const store = new CcrStore(undefined, rec);
    store.registerReversible([
      { id: 'rec_1', origin: 'optical', original: 'SLAB', contentType: 'prose', ratio: 0.4 },
    ]);
    expect(await store.retrieve('rec_1')).toBe('SLAB');
    expect(rec.retrievals).toHaveLength(1);
    expect(rec.retrievals[0]?.engine).toBe('optical');
    expect(rec.regret('prose', 'optical')).toBe(1);
  });

  it('records a retrieval when a semantic hash is fetched from the sidecar', async () => {
    const rec = new InMemoryRecorder();
    const store = new CcrStore({ retrieveHash: async () => 'FULL ORIGINAL' }, rec);
    store.registerReversible([{ id: 'h9', origin: 'semantic', contentType: 'json', ratio: 0.5 }]);
    expect(await store.retrieve('h9')).toBe('FULL ORIGINAL');
    expect(rec.retrievals).toHaveLength(1);
    expect(rec.retrievals[0]?.contentType).toBe('json');
  });

  it('noteRetrieved records without fetching, and no-ops for unknown ids', () => {
    const rec = new InMemoryRecorder();
    const store = new CcrStore(undefined, rec);
    store.registerReversible([
      { id: 'rec_2', origin: 'optical', original: 'X', contentType: 'log', ratio: 0.2 },
    ]);
    store.noteRetrieved('rec_2');
    store.noteRetrieved('never_registered');
    expect(rec.retrievals).toHaveLength(1);
    expect(rec.retrievals[0]?.id).toBe('rec_2');
  });

  it('dedupes offers for a repeated id', () => {
    const rec = new InMemoryRecorder();
    const store = new CcrStore(undefined, rec);
    const h: ReversibleHandle = { id: 'dup', origin: 'semantic', contentType: 'json' };
    store.registerReversible([h]);
    store.registerReversible([h]);
    expect(rec.offers).toHaveLength(1);
  });

  it('is a silent no-op when no recorder is attached', async () => {
    const store = new CcrStore();
    store.registerReversible([{ id: 'rec_3', origin: 'optical', original: 'Y' }]);
    expect(await store.retrieve('rec_3')).toBe('Y');
    store.noteRetrieved('rec_3'); // must not throw
  });
});
