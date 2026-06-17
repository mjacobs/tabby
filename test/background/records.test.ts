import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  appendCapped,
  appendRecords,
  buildCloseRecord,
  buildRecommendationRecords,
  buildStashRecord,
  buildUndoRecord,
  clearRecords,
  getRecords,
} from '@/background/records';
import type { RecordEntry } from '@/shared/messages';
import type { Recommendation } from '@/core/recommend';
import { tab } from '../helpers';

const entry = (n: number): RecordEntry => ({
  at: n,
  kind: 'undo',
  restored: n,
});

describe('appendCapped (pure)', () => {
  it('appends in order and caps at max, dropping oldest', () => {
    let log: RecordEntry[] = [];
    for (let i = 0; i < 1005; i++) log = appendCapped(log, [entry(i)], 1000);
    expect(log).toHaveLength(1000);
    expect((log[0] as { restored: number }).restored).toBe(5); // 0..4 dropped
    expect((log[999] as { restored: number }).restored).toBe(1004);
  });

  it('appends a whole batch at once and caps across the batch', () => {
    const batch = Array.from({ length: 6 }, (_, i) => entry(i));
    const log = appendCapped([entry(99)], batch, 4);
    expect(log.map((e) => (e as { restored: number }).restored)).toEqual([
      2, 3, 4, 5,
    ]);
  });

  it('is a no-op on an empty batch', () => {
    const log = [entry(1)];
    expect(appendCapped(log, [])).toBe(log);
  });
});

describe('record builders (pure)', () => {
  it('builds one recommendation record per flag with url looked up by id', () => {
    const tabs = [tab({ id: 1, url: 'https://a.com' }), tab({ id: 2, url: 'https://b.com' })];
    const recs: Recommendation[] = [
      { tabId: 2, reasons: ['bookmarked'] },
      { tabId: 9, reasons: ['stranded-auth'] }, // missing from tabs → empty url
    ];
    const out = buildRecommendationRecords(recs, tabs, 42);
    expect(out).toEqual([
      { at: 42, kind: 'recommendation', tabId: 2, url: 'https://b.com', reasons: ['bookmarked'] },
      { at: 42, kind: 'recommendation', tabId: 9, url: '', reasons: ['stranded-auth'] },
    ]);
  });

  it('builds a close record with ids and urls', () => {
    const closed = [tab({ id: 3, url: 'https://x.com' }), tab({ id: 4, url: 'https://y.com' })];
    expect(buildCloseRecord(closed, 7)).toEqual({
      at: 7,
      kind: 'close',
      tabIds: [3, 4],
      urls: ['https://x.com', 'https://y.com'],
    });
  });

  it('builds a stash record with ids and urls', () => {
    const stashed = [tab({ id: 3, url: 'https://x.com' }), tab({ id: 4, url: 'https://y.com' })];
    expect(buildStashRecord(stashed, 7)).toEqual({
      at: 7,
      kind: 'stash',
      tabIds: [3, 4],
      urls: ['https://x.com', 'https://y.com'],
    });
  });

  it('builds an undo record', () => {
    expect(buildUndoRecord(5, 7)).toEqual({ at: 7, kind: 'undo', restored: 5 });
  });
});

// --- storage glue against a stubbed chrome.storage.local ---------------------

function fakeChrome() {
  const local: Record<string, unknown> = {};
  return {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: local[key] }),
        set: async (obj: Record<string, unknown>) => {
          Object.assign(local, obj);
        },
        remove: async (key: string) => {
          delete local[key];
        },
      },
    },
  };
}

describe('appendRecords / getRecords / clearRecords', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('persists batched appends and reads them back in order', async () => {
    vi.stubGlobal('chrome', fakeChrome());
    await appendRecords([entry(1), entry(2)]);
    await appendRecords([entry(3)]);
    const records = await getRecords();
    expect(records.map((e) => (e as { restored: number }).restored)).toEqual([
      1, 2, 3,
    ]);
  });

  it('returns an empty array before anything is written', async () => {
    vi.stubGlobal('chrome', fakeChrome());
    expect(await getRecords()).toEqual([]);
  });

  it('does not write on an empty batch', async () => {
    const fake = fakeChrome();
    const setSpy = vi.spyOn(fake.storage.local, 'set');
    vi.stubGlobal('chrome', fake);
    await appendRecords([]);
    expect(setSpy).not.toHaveBeenCalled();
  });

  it('clears the log', async () => {
    vi.stubGlobal('chrome', fakeChrome());
    await appendRecords([entry(1)]);
    await clearRecords();
    expect(await getRecords()).toEqual([]);
  });
});
