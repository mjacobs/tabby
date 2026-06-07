import { describe, expect, it } from 'vitest';

import { buildCleanupPlan, type WindowSnapshot } from '@/core/buildCleanupPlan';
import { applyPlan, type TabsDriver } from '@/background/executor';
import { isGrouped } from '@/shared/tabs';
import { settings, tab } from '../helpers';

/** A fake driver that records the operations applyPlan issues, in order. */
function fakeDriver() {
  const calls: string[] = [];
  const driver: TabsDriver = {
    async removeTabs(ids) {
      calls.push(`remove ${ids.join(',')}`);
    },
    async moveTabs(ids, windowId, index) {
      calls.push(`move ${ids.join(',')} -> w${windowId}@${index}`);
    },
    async moveGroup(groupId, windowId, index) {
      calls.push(`group ${groupId} -> w${windowId}@${index}`);
    },
    async createWindow() {
      calls.push('createWindow');
      return 99;
    },
  };
  return { driver, calls };
}

function win(id: number, focused: boolean, tabs: WindowSnapshot['tabs']) {
  return { id, focused, tabs };
}

describe('applyPlan', () => {
  it('closes losers, moves incoming tabs, then reorders', () => {
    const a = tab({ url: 'https://a.com', windowId: 1 });
    const b = tab({ url: 'https://b.com', windowId: 2 });
    const plan = buildCleanupPlan({
      windows: [win(1, true, [a]), win(2, false, [b])],
      settings: settings(),
    });
    const { driver, calls } = fakeDriver();

    return applyPlan(plan, driver).then(() => {
      // No closes in this plan.
      expect(calls.some((c) => c.startsWith('remove'))).toBe(false);
      // A single ordered move both consolidates b into window 1 and places the
      // sorted survivors (a before b) at index 0.
      expect(calls).toContain(`move ${a.id},${b.id} -> w1@0`);
    });
  });

  it('removes duplicate losers', async () => {
    const keep = tab({ url: 'https://ex.com/p', windowId: 1, lastAccessed: 9 });
    const dup = tab({ url: 'https://ex.com/p', windowId: 2, lastAccessed: 1 });
    const plan = buildCleanupPlan({
      windows: [win(1, true, [keep]), win(2, false, [dup])],
      settings: settings(),
    });
    const { driver, calls } = fakeDriver();

    await applyPlan(plan, driver);
    expect(calls).toContain(`remove ${dup.id}`);
  });

  it('moves whole groups via moveGroup, not as loose tabs', async () => {
    const g1 = tab({ url: 'https://g.com/a', windowId: 2, groupId: 5 });
    const g2 = tab({ url: 'https://g.com/b', windowId: 2, groupId: 5 });
    const plan = buildCleanupPlan({
      windows: [win(1, true, []), win(2, false, [g1, g2])],
      settings: settings(),
    });
    const { driver, calls } = fakeDriver();

    await applyPlan(plan, driver);
    // The group is positioned as a unit at its sorted slot (index 0 here).
    expect(calls).toContain('group 5 -> w1@0');
  });

  it('repositions groups as units, never moving grouped tabs by id', async () => {
    // Regression: moving a grouped tab with chrome.tabs.move ejects it from its
    // group, so a multi-tab group must travel via moveGroup only. The previous
    // reorder moved every survivor (group members included) in one tabs.move,
    // which dissolved the group down to its last member in a real browser —
    // invisible to the old call-recording fake. This asserts the contract that
    // prevents it: no grouped tab id ever passes through moveTabs.
    const loose1 = tab({ url: 'https://a.com', windowId: 1 });
    const g1 = tab({ url: 'https://g.com/c', windowId: 2, groupId: 7 });
    const g2 = tab({ url: 'https://g.com/a', windowId: 2, groupId: 7 });
    const g3 = tab({ url: 'https://g.com/b', windowId: 2, groupId: 7 });
    const loose2 = tab({ url: 'https://z.com', windowId: 2 });
    const plan = buildCleanupPlan({
      windows: [win(1, true, [loose1]), win(2, false, [g1, g2, g3, loose2])],
      settings: settings(),
    });

    const movedByTabsMove: number[] = [];
    const groupMoves: number[] = [];
    const driver: TabsDriver = {
      async removeTabs() {},
      async moveTabs(moveIds) {
        movedByTabsMove.push(...moveIds);
      },
      async moveGroup(groupId) {
        groupMoves.push(groupId);
      },
      async createWindow() {
        return 99;
      },
    };

    await applyPlan(plan, driver);

    const groupedIds = new Set(
      plan.reviewTabs.filter(isGrouped).map((t) => t.id),
    );
    expect(groupedIds.size).toBe(3); // sanity: all 3 members survived planning
    expect(groupMoves).toContain(7); // the group is repositioned as a unit
    for (const id of movedByTabsMove) {
      expect(groupedIds.has(id)).toBe(false); // ...and never as loose tabs
    }
  });

  it('creates a window in new-window mode and targets it', async () => {
    const a = tab({ url: 'https://a.com', windowId: 1 });
    const plan = buildCleanupPlan({
      windows: [win(1, true, [a])],
      settings: settings({ consolidateTarget: 'new-window' }),
    });
    const { driver, calls } = fakeDriver();

    await applyPlan(plan, driver);
    expect(calls[0]).toBe('createWindow');
    expect(calls).toContain(`move ${a.id} -> w99@0`); // moved into the new window id
  });

  it('leads the strip with pinned tabs', async () => {
    const pinned = tab({ url: 'https://z.com', windowId: 1, pinned: true });
    const normal = tab({ url: 'https://a.com', windowId: 1 });
    const plan = buildCleanupPlan({
      windows: [win(1, true, [pinned, normal])],
      settings: settings(),
    });
    const { driver, calls } = fakeDriver();

    await applyPlan(plan, driver);
    expect(calls).toContain(`move ${pinned.id} -> w1@0`); // pinned block at 0
    expect(calls).toContain(`move ${normal.id} -> w1@1`); // rest after pinned
  });
});
