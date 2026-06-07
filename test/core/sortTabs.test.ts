import { describe, expect, it } from 'vitest';

import { sortTabs } from '@/core/sortTabs';
import { ids, settings, tab } from '../helpers';

describe('sortTabs', () => {
  it('orders ungrouped tabs by host then path', () => {
    const c = tab({ url: 'https://c.com/a' });
    const a1 = tab({ url: 'https://a.com/z' });
    const a2 = tab({ url: 'https://a.com/a' });
    const b = tab({ url: 'https://b.com/m' });

    const sorted = sortTabs([c, a1, a2, b], settings());
    expect(ids(sorted)).toEqual(ids([a2, a1, b, c]));
  });

  it('keeps pinned tabs leading, in original order', () => {
    const p1 = tab({ url: 'https://z.com', pinned: true, index: 0 });
    const p2 = tab({ url: 'https://a.com', pinned: true, index: 1 });
    const normal = tab({ url: 'https://a.com/page', index: 2 });

    const sorted = sortTabs([normal, p2, p1], settings());
    // Pinned first (z before a is NOT reordered — original order preserved).
    expect(ids(sorted)).toEqual(ids([p1, p2, normal]));
  });

  it('keeps tab groups contiguous and sorted within', () => {
    const g1b = tab({ url: 'https://g.com/b', groupId: 7 });
    const g1a = tab({ url: 'https://g.com/a', groupId: 7 });
    const loose = tab({ url: 'https://h.com/x' });

    const sorted = sortTabs([g1b, loose, g1a], settings());
    // Group sorts internally (a before b) and stays together; group key g.com
    // sorts before h.com.
    expect(ids(sorted)).toEqual(ids([g1a, g1b, loose]));
  });

  it('does not interleave grouped and ungrouped tabs', () => {
    // An ungrouped tab whose key falls "between" a group's members must not
    // split the group.
    const gA = tab({ url: 'https://site.com/a', groupId: 3 });
    const gC = tab({ url: 'https://site.com/c', groupId: 3 });
    const loose = tab({ url: 'https://site.com/b' });

    const sorted = sortTabs([gA, loose, gC], settings());
    const positions = ids(sorted);
    // group members adjacent
    expect(Math.abs(positions.indexOf(gA.id) - positions.indexOf(gC.id))).toBe(
      1,
    );
  });

  it('is stable for equal keys via original position', () => {
    const a = tab({ url: 'https://ex.com/p', index: 5 });
    const b = tab({ url: 'https://ex.com/p', index: 2 });
    const sorted = sortTabs([a, b], settings());
    expect(ids(sorted)).toEqual(ids([b, a]));
  });
});
