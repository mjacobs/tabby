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
      return true;
    },
    async groupTabs(groupId, tabIds) {
      calls.push(`regroup ${groupId}: ${tabIds.join(',')}`);
    },
    async createWindow() {
      calls.push('createWindow');
      return 99;
    },
  };
  return { driver, calls };
}

interface StripTab {
  id: number;
  groupId?: number;
}

/**
 * A stateful fake that models the real tab strip — including the Chrome quirk
 * the original call-recording fake missed: `chrome.tabs.move` on a grouped tab
 * whose target index falls outside the group's contiguous span EJECTS the tab
 * from its group (groupId cleared). In-span moves keep membership.
 * `ejectOnAnyMove` simulates the harsher historical behavior where any
 * tabs.move ejects, to exercise the regroup repair path.
 */
function stripFake(
  initial: Record<number, StripTab[]>,
  opts: { ejectOnAnyMove?: boolean; failMoveGroup?: boolean } = {},
) {
  const windows = new Map<number, StripTab[]>(
    Object.entries(initial).map(([k, v]) => [
      Number(k),
      v.map((t) => ({ ...t })),
    ]),
  );

  const find = (tabId: number) => {
    for (const [winId, tabs] of windows) {
      const idx = tabs.findIndex((t) => t.id === tabId);
      if (idx !== -1) return { winId, idx };
    }
    throw new Error(`unknown tab ${tabId}`);
  };

  const driver: TabsDriver = {
    async removeTabs(ids) {
      for (const id of ids) {
        const { winId, idx } = find(id);
        windows.get(winId)!.splice(idx, 1);
      }
    },
    async moveTabs(ids, windowId, index) {
      // Chrome moves a multi-id batch one tab at a time, left to right.
      let at = index;
      for (const id of ids) {
        const { winId, idx } = find(id);
        const [moving] = windows.get(winId)!.splice(idx, 1);
        const dest = windows.get(windowId)!;
        const target = at === -1 ? dest.length : Math.min(at, dest.length);
        if (moving.groupId !== undefined) {
          const positions = dest.flatMap((t, p) =>
            t.groupId === moving.groupId ? [p] : [],
          );
          const inSpan =
            positions.length > 0 &&
            target >= positions[0] &&
            target <= positions[positions.length - 1] + 1;
          if (opts.ejectOnAnyMove || !inSpan) delete moving.groupId;
        }
        dest.splice(target, 0, moving);
        if (at !== -1) at += 1;
      }
    },
    async moveGroup(groupId, windowId, index) {
      if (opts.failMoveGroup) return false; // group stays at its old span
      for (const [winId, tabs] of windows) {
        const members = tabs.filter((t) => t.groupId === groupId);
        if (members.length === 0) continue;
        windows.set(
          winId,
          tabs.filter((t) => t.groupId !== groupId),
        );
        const dest = windows.get(windowId)!;
        const at = index === -1 ? dest.length : Math.min(index, dest.length);
        dest.splice(at, 0, ...members);
        return true;
      }
      return false;
    },
    async groupTabs(groupId, tabIds) {
      for (const id of tabIds) {
        const { winId, idx } = find(id);
        windows.get(winId)![idx].groupId = groupId;
      }
    },
    async createWindow() {
      windows.set(99, []);
      return 99;
    },
  };

  const order = (winId: number) => windows.get(winId)!.map((t) => t.id);
  const groupOf = (tabId: number) => {
    const { winId, idx } = find(tabId);
    return windows.get(winId)![idx].groupId;
  };
  return { driver, order, groupOf };
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

  it('positions whole groups via moveGroup at their sorted slot', async () => {
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

  it('models ejection in the fake: out-of-span moves dissolve membership', async () => {
    // Sanity-check the fake itself — the original regression (f2be518) hid in
    // a fake that treated tabs.move as a pure reorder. This proves the quirk
    // is now representable: an in-span move keeps membership, an out-of-span
    // move clears it.
    const { driver, groupOf } = stripFake({
      1: [{ id: 1, groupId: 7 }, { id: 2, groupId: 7 }, { id: 3, groupId: 7 }, { id: 4 }],
    });

    await driver.moveTabs([2], 1, 0); // inside the group's span
    expect(groupOf(2)).toBe(7);
    await driver.moveTabs([2], 1, 3); // past the span — ejected
    expect(groupOf(2)).toBeUndefined();
  });

  it('sorts within a group by URL without ejecting members', async () => {
    // The within-group re-sort moves grouped tabs by id, but only to indices
    // inside the group's span — so on the ejection-modeling fake the strip
    // must end up in the plan's URL-sorted order AND every member must keep
    // its groupId.
    const loose1 = tab({ url: 'https://a.com', windowId: 1 });
    const g1 = tab({ url: 'https://g.com/c', windowId: 2, groupId: 7 });
    const g2 = tab({ url: 'https://g.com/a', windowId: 2, groupId: 7 });
    const g3 = tab({ url: 'https://g.com/b', windowId: 2, groupId: 7 });
    const loose2 = tab({ url: 'https://z.com', windowId: 2 });
    const plan = buildCleanupPlan({
      windows: [win(1, true, [loose1]), win(2, false, [g1, g2, g3, loose2])],
      settings: settings(),
    });

    // Plan sanity: the group's members are URL-sorted within the group.
    expect(plan.reviewTabs.filter(isGrouped).map((t) => t.id)).toEqual([
      g2.id,
      g3.id,
      g1.id,
    ]);

    const { driver, order, groupOf } = stripFake({
      1: [{ id: loose1.id }],
      2: [
        { id: g1.id, groupId: 7 },
        { id: g2.id, groupId: 7 },
        { id: g3.id, groupId: 7 },
        { id: loose2.id },
      ],
    });

    await applyPlan(plan, driver);

    expect(order(1)).toEqual(plan.targetOrder); // strip matches the review list
    for (const id of [g1.id, g2.id, g3.id]) {
      expect(groupOf(id)).toBe(7); // ...and no member was ejected
    }
  });

  it('repairs membership via groupTabs when the browser ejects on any move', async () => {
    // Older Chrome builds ejected a grouped tab on ANY tabs.move, in-span or
    // not. The regroup correction step must restore membership in that case.
    const g1 = tab({ url: 'https://g.com/b', windowId: 1, groupId: 7 });
    const g2 = tab({ url: 'https://g.com/a', windowId: 1, groupId: 7 });
    const plan = buildCleanupPlan({
      windows: [win(1, true, [g1, g2])],
      settings: settings(),
    });

    const { driver, groupOf } = stripFake(
      { 1: [{ id: g1.id, groupId: 7 }, { id: g2.id, groupId: 7 }] },
      { ejectOnAnyMove: true },
    );

    await applyPlan(plan, driver);
    expect(groupOf(g1.id)).toBe(7);
    expect(groupOf(g2.id)).toBe(7);
  });

  it('skips the within-group re-sort when moveGroup fails (group span unknown)', async () => {
    // chromeDriver.moveGroup swallows errors (group dissolved mid-run, saved
    // groups, etc.). If the group never reached [index, index+size), the
    // per-tab in-span moves would target out-of-span indices and eject every
    // member they touch — so a failed moveGroup must skip them entirely.
    const g1 = tab({ url: 'https://g.com/b', windowId: 2, groupId: 7 });
    const g2 = tab({ url: 'https://g.com/a', windowId: 2, groupId: 7 });
    const plan = buildCleanupPlan({
      windows: [win(1, true, []), win(2, false, [g1, g2])],
      settings: settings(),
    });

    const { driver, groupOf, order } = stripFake(
      { 1: [], 2: [{ id: g1.id, groupId: 7 }, { id: g2.id, groupId: 7 }] },
      { failMoveGroup: true },
    );

    await applyPlan(plan, driver);
    // The group stays intact at its old position, internal order untouched.
    expect(order(2)).toEqual([g1.id, g2.id]);
    expect(groupOf(g1.id)).toBe(7);
    expect(groupOf(g2.id)).toBe(7);
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
