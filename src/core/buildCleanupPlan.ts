// Pure cleanup planning — no Chrome APIs.
//
// Takes a snapshot of the browser's normal windows and produces a declarative
// plan the background executor (Phase 2) applies. Keeping this pure makes the
// whole consolidate → dedup → sort pipeline testable without a browser.
//
// Pipeline:
//   1. Dedup across ALL windows (so cross-window duplicates collapse).
//   2. Consolidate survivors into the target window — EXCEPT protected pinned
//      tabs, which stay in their original window (user's explicit choice).
//   3. Sort the target window's surviving tabs by URL.

import { dedupe, type DuplicateGroup } from '@/core/dedupe';
import { sortTabs } from '@/core/sortTabs';
import type { Settings, TabInfo } from '@/shared/types';
import { isGrouped } from '@/shared/tabs';

export interface WindowSnapshot {
  id: number;
  focused: boolean;
  /** Only normal windows should be passed; caller filters popups/devtools. */
  tabs: TabInfo[];
}

export interface PlanInput {
  windows: WindowSnapshot[];
  settings: Settings;
}

export interface CleanupPlan {
  /** Target window for consolidation; null => executor creates a new window. */
  targetWindowId: number | null;
  /** Duplicate losers to close. */
  closeTabIds: number[];
  /** Group ids to relocate into the target window (moved as whole groups). */
  groupMoveIds: number[];
  /** Ungrouped tab ids to relocate into the target window. */
  moveTabIds: number[];
  /** Final left-to-right order (tab ids) for the target window. */
  targetOrder: number[];
  /** Protected pinned survivors left in place in another window. */
  stayingPinnedTabIds: number[];
  /** Non-target windows fully vacated by the plan (safe to offer to close). */
  emptyWindowIds: number[];
  /** Target-window survivors in final order — handed to the review view. */
  reviewTabs: TabInfo[];
  /** Duplicate groups that were collapsed (for "what changed" reporting). */
  duplicateGroups: DuplicateGroup[];
}

function unique(ids: number[]): number[] {
  return [...new Set(ids)];
}

export function buildCleanupPlan({ windows, settings }: PlanInput): CleanupPlan {
  const newWindowMode = settings.consolidateTarget === 'new-window';
  const currentWindowMode = settings.consolidateTarget === 'current-window';
  const focused = windows.find((w) => w.focused) ?? windows[0];
  const targetWindowId = newWindowMode ? null : (focused?.id ?? null);

  // current-window mode: dedup + sort within the focused window only, so the
  // working set is narrowed to it. Other windows never enter dedup/consolidate,
  // leaving their tabs untouched (nothing closed, moved, or vacated).
  const workingWindows = currentWindowMode && focused ? [focused] : windows;
  const allTabs = workingWindows.flatMap((w) => w.tabs);

  const { keep, close, duplicateGroups } = dedupe(allTabs, settings);

  // Protected pinned tabs that aren't already in the target window stay put.
  const staysInPlace = (t: TabInfo) =>
    settings.protectPinned && t.pinned && t.windowId !== targetWindowId;

  const stayingPinned = keep.filter(staysInPlace);
  const targetTabs = keep.filter((t) => !staysInPlace(t));

  // Everything bound for the target window that isn't already there must move.
  const incoming = targetTabs.filter((t) => t.windowId !== targetWindowId);
  const groupMoveIds = unique(
    incoming.filter(isGrouped).map((t) => t.groupId!),
  );
  const moveTabIds = incoming.filter((t) => !isGrouped(t)).map((t) => t.id);

  const ordered = sortTabs(targetTabs, settings);

  // A non-target window empties unless it retains a staying-pinned survivor.
  // Only windows in the working set can be vacated — in current-window mode that
  // is just the focused (target) window, so others are never reported empty.
  const stayingByWindow = new Set(stayingPinned.map((t) => t.windowId));
  const emptyWindowIds = workingWindows
    .filter((w) => w.id !== targetWindowId && !stayingByWindow.has(w.id))
    .map((w) => w.id);

  return {
    targetWindowId,
    closeTabIds: close.map((t) => t.id),
    groupMoveIds,
    moveTabIds,
    targetOrder: ordered.map((t) => t.id),
    stayingPinnedTabIds: stayingPinned.map((t) => t.id),
    emptyWindowIds,
    reviewTabs: ordered,
    duplicateGroups,
  };
}
