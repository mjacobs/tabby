import { describe, expect, it } from 'vitest';

import { dedupe } from '@/core/dedupe';
import { ids, settings, tab } from '../helpers';

describe('dedupe', () => {
  it('collapses tabs whose normalized URL matches', () => {
    const a = tab({ url: 'https://ex.com/p' });
    const b = tab({ url: 'https://ex.com/p?utm_source=x' });
    const c = tab({ url: 'https://ex.com/p#frag' });
    const other = tab({ url: 'https://ex.com/other' });

    const { close, keep } = dedupe([a, b, c, other], settings());
    expect(close.length).toBe(2);
    expect(keep).toContain(other);
    // Exactly one of the three variants survives.
    expect(keep.filter((t) => [a, b, c].includes(t))).toHaveLength(1);
  });

  it('reports duplicate groups with keep + close', () => {
    const a = tab({ url: 'https://ex.com/p', lastAccessed: 10 });
    const b = tab({ url: 'https://ex.com/p', lastAccessed: 20 });
    const { duplicateGroups } = dedupe([a, b], settings());

    expect(duplicateGroups).toHaveLength(1);
    expect(duplicateGroups[0].keep).toBe(b);
    expect(duplicateGroups[0].close).toEqual([a]);
  });

  describe('keep policy', () => {
    const a = tab({ url: 'https://ex.com/p', index: 1, lastAccessed: 100 });
    const b = tab({ url: 'https://ex.com/p', index: 2, lastAccessed: 300 });
    const c = tab({ url: 'https://ex.com/p', index: 3, lastAccessed: 200 });

    it('most-recent keeps the highest lastAccessed', () => {
      const { keep } = dedupe([a, b, c], settings({ keepPolicy: 'most-recent' }));
      expect(keep).toEqual([b]);
    });

    it('oldest keeps the lowest lastAccessed', () => {
      const { keep } = dedupe([a, b, c], settings({ keepPolicy: 'oldest' }));
      expect(keep).toEqual([a]);
    });

    it('leftmost keeps the lowest position', () => {
      const { keep } = dedupe([c, b, a], settings({ keepPolicy: 'leftmost' }));
      expect(keep).toEqual([a]);
    });

    it('breaks lastAccessed ties by position deterministically', () => {
      const x = tab({ url: 'https://ex.com/p', index: 5, lastAccessed: 50 });
      const y = tab({ url: 'https://ex.com/p', index: 2, lastAccessed: 50 });
      const { keep } = dedupe([x, y], settings({ keepPolicy: 'most-recent' }));
      expect(keep).toEqual([y]); // lower index wins the tie
    });
  });

  describe('protections', () => {
    it('never closes or groups pinned tabs by default', () => {
      const pinned = tab({ url: 'https://ex.com/p', pinned: true });
      const dup = tab({ url: 'https://ex.com/p' });
      const { keep, close } = dedupe([pinned, dup], settings());
      // Pinned is set aside; the unpinned tab is now a singleton → also kept.
      expect(keep).toEqual([pinned, dup]);
      expect(close).toEqual([]);
    });

    it('dedups pinned tabs when protectPinned is off', () => {
      const pinned = tab({ url: 'https://ex.com/p', pinned: true, index: 1 });
      const dup = tab({ url: 'https://ex.com/p', index: 2 });
      const { close } = dedupe(
        [pinned, dup],
        settings({ protectPinned: false, keepPolicy: 'leftmost' }),
      );
      expect(close).toEqual([dup]);
    });

    it('protects audible tabs only when protectAudible is on', () => {
      const audible = tab({ url: 'https://ex.com/p', audible: true });
      const silent = tab({ url: 'https://ex.com/p' });

      expect(dedupe([audible, silent], settings()).close).toHaveLength(1);
      expect(
        dedupe([audible, silent], settings({ protectAudible: true })).close,
      ).toEqual([]);
    });

    it('protects browser/extension/file pages from dedup', () => {
      const a = tab({ url: 'chrome://extensions' });
      const b = tab({ url: 'chrome://extensions' });
      const ext1 = tab({ url: 'chrome-extension://abc/p.html' });
      const ext2 = tab({ url: 'chrome-extension://abc/p.html' });
      const { close } = dedupe([a, b, ext1, ext2], settings());
      expect(close).toEqual([]);
    });
  });

  describe('blank tabs', () => {
    const blank = (over = {}) => tab({ url: 'about:blank', ...over });

    it('purge closes blanks but never the active one (default)', () => {
      const b1 = blank();
      const active = blank({ active: true });
      const b3 = tab({ url: '', index: 9 }); // empty URL is also blank
      const web = tab({ url: 'https://ex.com' });

      const { keep, close } = dedupe([b1, active, b3, web], settings());
      expect(close).toEqual([b1, b3]);
      expect(keep).toEqual([active, web]);
    });

    it('collapse keeps exactly one blank, preferring the active one', () => {
      const b1 = blank({ index: 1 });
      const active = blank({ index: 2, active: true });
      const b3 = blank({ index: 3 });

      const { keep, close } = dedupe(
        [b1, active, b3],
        settings({ blankTabPolicy: 'collapse' }),
      );
      expect(keep).toEqual([active]);
      expect(close).toEqual([b1, b3]);
    });

    it('protect keeps every blank', () => {
      const tabs = [blank(), blank(), blank({ active: true })];
      const { close } = dedupe(tabs, settings({ blankTabPolicy: 'protect' }));
      expect(close).toEqual([]);
    });
  });

  describe('active-tab protection', () => {
    it('never closes the active tab even when it is a duplicate', () => {
      const recent = tab({ url: 'https://ex.com/p', lastAccessed: 100 });
      const active = tab({ url: 'https://ex.com/p', lastAccessed: 1, active: true });
      const { keep, close } = dedupe([recent, active], settings());
      // Active wins the keeper contest despite being far less recent.
      expect(keep).toEqual([active]);
      expect(close).toEqual([recent]);
    });

    it('keeps both when duplicates are active in different windows', () => {
      const a = tab({ url: 'https://ex.com/p', windowId: 1, active: true });
      const b = tab({ url: 'https://ex.com/p', windowId: 2, active: true });
      const { close } = dedupe([a, b], settings());
      expect(close).toEqual([]);
    });
  });

  describe('settings change what counts as a duplicate', () => {
    it('stripAllQuery merges tabs that differ only by query', () => {
      const a = tab({ url: 'https://ex.com/p?q=1' });
      const b = tab({ url: 'https://ex.com/p?q=2' });

      // Default: different real query params => distinct.
      expect(dedupe([a, b], settings()).close).toEqual([]);
      // Aggressive: ignore all query => duplicates.
      expect(
        dedupe([a, b], settings({ normalize: { stripAllQuery: true } })).close,
      ).toHaveLength(1);
    });

    it('ignoreWww merges www and bare domains only when enabled', () => {
      const a = tab({ url: 'https://www.ex.com/p' });
      const b = tab({ url: 'https://ex.com/p' });

      expect(dedupe([a, b], settings()).close).toEqual([]);
      expect(
        dedupe([a, b], settings({ normalize: { ignoreWww: true } })).close,
      ).toHaveLength(1);
    });
  });

  it('is a no-op when there are no duplicates', () => {
    const tabs = [
      tab({ url: 'https://a.com' }),
      tab({ url: 'https://b.com' }),
      tab({ url: 'https://c.com' }),
    ];
    const { close, keep, duplicateGroups } = dedupe(tabs, settings());
    expect(close).toEqual([]);
    expect(ids(keep)).toEqual(ids(tabs));
    expect(duplicateGroups).toEqual([]);
  });

  it('dedups across windows', () => {
    const a = tab({ url: 'https://ex.com/p', windowId: 1, lastAccessed: 1 });
    const b = tab({ url: 'https://ex.com/p', windowId: 2, lastAccessed: 2 });
    const { keep, close } = dedupe([a, b], settings());
    expect(keep).toEqual([b]);
    expect(close).toEqual([a]);
  });
});
