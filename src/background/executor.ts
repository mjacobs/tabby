// Applies a CleanupPlan to the real browser.
//
// All Chrome calls go through an injected `TabsDriver`, so the sequencing logic
// in `applyPlan` is unit-testable with a fake driver and the chrome-specific
// quirks live in one small adapter (`chromeDriver`).

import type { CleanupPlan } from '@/core/buildCleanupPlan';
import { isGrouped } from '@/shared/tabs';

/** The browser operations the executor needs. Index -1 means "append". */
export interface TabsDriver {
  removeTabs(ids: number[]): Promise<void>;
  moveTabs(ids: number[], windowId: number, index: number): Promise<void>;
  moveGroup(groupId: number, windowId: number, index: number): Promise<void>;
  /** Create an empty normal window and return its id. */
  createWindow(): Promise<number>;
}

/**
 * Execute the plan: close losers, then realize the sorted target order in the
 * strip — pinned tabs lead, then each unit placed left-to-right at a running
 * index. Both consolidation (pulling tabs in from other windows) and the final
 * reorder happen in this single pass, since `chrome.tabs.move` /
 * `chrome.tabGroups.move` reposition cross-window in one call.
 *
 * Group integrity: a tab group is repositioned with `moveGroup` (a whole-group
 * move) and its members are NEVER moved by id. Moving a grouped tab with
 * `chrome.tabs.move` ejects it from its group, so the earlier approach — a
 * single ordered `moveTabs` over the whole strip — silently dissolved every
 * multi-tab group down to its last member even though the tabs stayed
 * positionally contiguous. Groups travel as units instead. (A group's internal
 * order is whatever `moveGroup` preserves; the review list still shows the
 * sorted order.)
 */
export async function applyPlan(
  plan: CleanupPlan,
  driver: TabsDriver,
): Promise<void> {
  const targetId = plan.targetWindowId ?? (await driver.createWindow());

  if (plan.closeTabIds.length) {
    await driver.removeTabs(plan.closeTabIds);
  }

  // Pinned tabs lead the strip.
  const pinnedIds = plan.reviewTabs.filter((t) => t.pinned).map((t) => t.id);
  if (pinnedIds.length) {
    await driver.moveTabs(pinnedIds, targetId, 0);
  }

  // Walk the remaining survivors in sorted order. Consecutive ungrouped tabs
  // move together as one batch; each group moves as a whole unit.
  let index = pinnedIds.length;
  const rest = plan.reviewTabs.filter((t) => !t.pinned);
  let looseRun: number[] = [];

  const flushLoose = async (): Promise<void> => {
    if (looseRun.length === 0) return;
    await driver.moveTabs(looseRun, targetId, index);
    index += looseRun.length;
    looseRun = [];
  };

  for (let i = 0; i < rest.length; ) {
    const t = rest[i];
    if (isGrouped(t)) {
      await flushLoose();
      const groupId = t.groupId!;
      let size = 0;
      // reviewTabs keeps a group's members contiguous, so this run is the
      // whole group.
      while (i < rest.length && rest[i].groupId === groupId) {
        size += 1;
        i += 1;
      }
      await driver.moveGroup(groupId, targetId, index);
      index += size;
    } else {
      looseRun.push(t.id);
      i += 1;
    }
  }
  await flushLoose();
}

/** Run an operation over ids in bulk, falling back to per-id on failure so one
 * stale tab id can't abort the whole batch. */
async function tolerant(
  ids: number[],
  bulk: (ids: number[]) => Promise<unknown>,
  single: (id: number) => Promise<unknown>,
): Promise<void> {
  if (ids.length === 0) return;
  try {
    await bulk(ids);
  } catch {
    for (const id of ids) {
      try {
        await single(id);
      } catch {
        // Tab vanished mid-run (user closed it, etc.) — skip it.
      }
    }
  }
}

/** The real driver, backed by the chrome.* APIs. */
export const chromeDriver: TabsDriver = {
  async removeTabs(ids) {
    await tolerant(
      ids,
      (batch) => chrome.tabs.remove(batch),
      (id) => chrome.tabs.remove(id),
    );
  },
  async moveTabs(ids, windowId, index) {
    await tolerant(
      ids,
      (batch) => chrome.tabs.move(batch, { windowId, index }),
      (id) => chrome.tabs.move(id, { windowId, index }),
    );
  },
  async moveGroup(groupId, windowId, index) {
    try {
      await chrome.tabGroups.move(groupId, { windowId, index });
    } catch {
      // Group may have been dissolved mid-run — skip it.
    }
  },
  async createWindow() {
    const win = await chrome.windows.create({ focused: true });
    if (win?.id == null) throw new Error('Failed to create target window');
    return win.id;
  },
};
