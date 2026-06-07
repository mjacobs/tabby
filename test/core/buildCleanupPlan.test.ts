import { describe, expect, it } from 'vitest';

import { buildCleanupPlan, type WindowSnapshot } from '@/core/buildCleanupPlan';
import { settings, tab } from '../helpers';

function win(id: number, focused: boolean, tabs: WindowSnapshot['tabs']) {
  return { id, focused, tabs };
}

describe('buildCleanupPlan', () => {
  it('single clean window: no closes, no moves, just sorted order', () => {
    const b = tab({ url: 'https://b.com', windowId: 1 });
    const a = tab({ url: 'https://a.com', windowId: 1 });
    const plan = buildCleanupPlan({
      windows: [win(1, true, [b, a])],
      settings: settings(),
    });

    expect(plan.targetWindowId).toBe(1);
    expect(plan.closeTabIds).toEqual([]);
    expect(plan.moveTabIds).toEqual([]);
    expect(plan.targetOrder).toEqual([a.id, b.id]);
    expect(plan.emptyWindowIds).toEqual([]);
  });

  it('consolidates non-focused tabs into the focused window', () => {
    const t1 = tab({ url: 'https://a.com', windowId: 1 });
    const t2 = tab({ url: 'https://b.com', windowId: 2 });
    const plan = buildCleanupPlan({
      windows: [win(1, true, [t1]), win(2, false, [t2])],
      settings: settings(),
    });

    expect(plan.targetWindowId).toBe(1);
    expect(plan.moveTabIds).toEqual([t2.id]);
    expect(plan.emptyWindowIds).toEqual([2]);
  });

  it('dedups across windows before consolidating', () => {
    const keep = tab({ url: 'https://ex.com/p', windowId: 1, lastAccessed: 9 });
    const dup = tab({ url: 'https://ex.com/p', windowId: 2, lastAccessed: 1 });
    const plan = buildCleanupPlan({
      windows: [win(1, true, [keep]), win(2, false, [dup])],
      settings: settings(),
    });

    expect(plan.closeTabIds).toEqual([dup.id]);
    // The closed dup was the only tab in window 2 → window empties.
    expect(plan.emptyWindowIds).toEqual([2]);
    expect(plan.targetOrder).toEqual([keep.id]);
  });

  it('leaves protected pinned tabs in their non-target window', () => {
    const pinned = tab({ url: 'https://pin.com', windowId: 2, pinned: true });
    const normal = tab({ url: 'https://x.com', windowId: 2 });
    const plan = buildCleanupPlan({
      windows: [win(1, true, []), win(2, false, [pinned, normal])],
      settings: settings(),
    });

    expect(plan.stayingPinnedTabIds).toEqual([pinned.id]);
    expect(plan.moveTabIds).toEqual([normal.id]);
    // Window 2 still holds the pinned tab → not reported empty.
    expect(plan.emptyWindowIds).toEqual([]);
  });

  it('moves whole groups via groupMoveIds, not individual tabs', () => {
    const g1 = tab({ url: 'https://g.com/a', windowId: 2, groupId: 5 });
    const g2 = tab({ url: 'https://g.com/b', windowId: 2, groupId: 5 });
    const loose = tab({ url: 'https://h.com', windowId: 2 });
    const plan = buildCleanupPlan({
      windows: [win(1, true, []), win(2, false, [g1, g2, loose])],
      settings: settings(),
    });

    expect(plan.groupMoveIds).toEqual([5]);
    expect(plan.moveTabIds).toEqual([loose.id]);
  });

  it('new-window mode targets a fresh window and empties all others', () => {
    const t1 = tab({ url: 'https://a.com', windowId: 1 });
    const t2 = tab({ url: 'https://b.com', windowId: 2 });
    const plan = buildCleanupPlan({
      windows: [win(1, true, [t1]), win(2, false, [t2])],
      settings: settings({ consolidateTarget: 'new-window' }),
    });

    expect(plan.targetWindowId).toBeNull();
    expect(new Set(plan.moveTabIds)).toEqual(new Set([t1.id, t2.id]));
    expect(new Set(plan.emptyWindowIds)).toEqual(new Set([1, 2]));
  });

  it('reviewTabs mirrors targetOrder as TabInfo', () => {
    const b = tab({ url: 'https://b.com', windowId: 1 });
    const a = tab({ url: 'https://a.com', windowId: 1 });
    const plan = buildCleanupPlan({
      windows: [win(1, true, [b, a])],
      settings: settings(),
    });
    expect(plan.reviewTabs.map((t) => t.id)).toEqual(plan.targetOrder);
  });
});
