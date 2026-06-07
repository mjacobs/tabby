import { describe, expect, it } from 'vitest';

import { buildCleanupPlan, type WindowSnapshot } from '@/core/buildCleanupPlan';
import { applyPlan, type TabsDriver } from '@/background/executor';
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
      // Tab b is consolidated into window 1, then the strip is reordered.
      expect(calls).toContain('move 2 -> w1@-1');
      // No closes in this plan.
      expect(calls.some((c) => c.startsWith('remove'))).toBe(false);
      // Reorder places the sorted survivors (a before b) at index 0.
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
    expect(calls).toContain('group 5 -> w1@-1');
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
    expect(calls).toContain(`move ${a.id} -> w99@-1`); // moved into the new window id
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
