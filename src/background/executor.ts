// Applies a CleanupPlan to the real browser.
//
// All Chrome calls go through an injected `TabsDriver`, so the sequencing logic
// in `applyPlan` is unit-testable with a fake driver and the chrome-specific
// quirks live in one small adapter (`chromeDriver`).

import type { CleanupPlan } from '@/core/buildCleanupPlan';

/** The browser operations the executor needs. Index -1 means "append". */
export interface TabsDriver {
  removeTabs(ids: number[]): Promise<void>;
  moveTabs(ids: number[], windowId: number, index: number): Promise<void>;
  moveGroup(groupId: number, windowId: number, index: number): Promise<void>;
  /** Create an empty normal window and return its id. */
  createWindow(): Promise<number>;
}

/**
 * Execute the plan: close losers, consolidate survivors into the target window
 * (groups as units, pinned tabs left where the plan says), then reorder the
 * strip to the sorted target order (pinned block first).
 */
export async function applyPlan(
  plan: CleanupPlan,
  driver: TabsDriver,
): Promise<void> {
  const targetId =
    plan.targetWindowId ?? (await driver.createWindow());

  if (plan.closeTabIds.length) {
    await driver.removeTabs(plan.closeTabIds);
  }

  // Bring whole groups in first, then ungrouped tabs (appended to the end).
  for (const groupId of plan.groupMoveIds) {
    await driver.moveGroup(groupId, targetId, -1);
  }
  if (plan.moveTabIds.length) {
    await driver.moveTabs(plan.moveTabIds, targetId, -1);
  }

  // Reorder: pinned tabs must lead the strip, then the rest in sorted order.
  // Group members are adjacent in reviewTabs, so a single ordered move keeps
  // each group contiguous.
  const pinnedIds = plan.reviewTabs.filter((t) => t.pinned).map((t) => t.id);
  const restIds = plan.reviewTabs.filter((t) => !t.pinned).map((t) => t.id);
  if (pinnedIds.length) {
    await driver.moveTabs(pinnedIds, targetId, 0);
  }
  if (restIds.length) {
    await driver.moveTabs(restIds, targetId, pinnedIds.length);
  }
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
