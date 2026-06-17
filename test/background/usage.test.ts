import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bumpCounts,
  bumpUsage,
  clearUsage,
  getUsage,
} from '@/background/usage';
import type { UsageCounts } from '@/shared/messages';

describe('bumpCounts (pure)', () => {
  it('increments an existing key by 1 by default', () => {
    expect(bumpCounts({ cleanupRun: 2 }, 'cleanupRun')).toEqual({
      cleanupRun: 3,
    });
  });

  it('starts a missing key at the bumped amount', () => {
    expect(bumpCounts({}, 'tabsClosed')).toEqual({ tabsClosed: 1 });
    expect(bumpCounts({}, 'tabsClosed', 5)).toEqual({ tabsClosed: 5 });
  });

  it('tracks multiple keys independently', () => {
    let c: UsageCounts = {};
    c = bumpCounts(c, 'cleanupRun');
    c = bumpCounts(c, 'surface.page');
    c = bumpCounts(c, 'cleanupRun');
    expect(c).toEqual({ cleanupRun: 2, 'surface.page': 1 });
  });

  it('does not mutate the input map', () => {
    const input = { undo: 1 };
    const out = bumpCounts(input, 'undo');
    expect(out).not.toBe(input);
    expect(input).toEqual({ undo: 1 }); // untouched
    expect(out).toEqual({ undo: 2 });
  });

  it('is a no-op for a non-positive amount (zero flagged/closed)', () => {
    const input = { recommendationsFlagged: 3 };
    expect(bumpCounts(input, 'recommendationsFlagged', 0)).toBe(input);
    expect(bumpCounts(input, 'recommendationsFlagged', -2)).toBe(input);
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

describe('bumpUsage / getUsage / clearUsage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns an empty map before anything is counted', async () => {
    vi.stubGlobal('chrome', fakeChrome());
    expect(await getUsage()).toEqual({});
  });

  it('persists increments across calls and reads them back', async () => {
    vi.stubGlobal('chrome', fakeChrome());
    await bumpUsage('cleanupRun');
    await bumpUsage('cleanupRun');
    await bumpUsage('tabsClosed', 4);
    expect(await getUsage()).toEqual({ cleanupRun: 2, tabsClosed: 4 });
  });

  it('does not write on a non-positive amount', async () => {
    const fake = fakeChrome();
    const setSpy = vi.spyOn(fake.storage.local, 'set');
    vi.stubGlobal('chrome', fake);
    await bumpUsage('recommendationsFlagged', 0);
    expect(setSpy).not.toHaveBeenCalled();
    expect(await getUsage()).toEqual({});
  });

  it('clears all counts', async () => {
    vi.stubGlobal('chrome', fakeChrome());
    await bumpUsage('undo');
    await clearUsage();
    expect(await getUsage()).toEqual({});
  });
});
