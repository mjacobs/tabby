// The single source of item order for the review list.
//
// Flattens the canonical tab order into the exact sequence of list items the
// user sees — group headers interleaved with rows — so virtualization can slice
// this list rather than re-deriving the order. Headers are emitted from the
// canonical tab order, so a collapsed group (which has no visible members) still
// shows its header in place. Each row carries its index into the visible-tabs
// array, which is what the cursor model indexes — so the cursor maps straight
// onto the rendered rows. (kata#yrez, kata#mvzz)

import type { TabInfo } from '@/shared/types';
import { isGrouped } from '@/shared/tabs';
import type { ReviewUiState } from '@/view/state';

/**
 * One entry in the rendered list: either a group header or a tab row. Headers
 * are emitted from the canonical tab order so a collapsed group (which has no
 * visible members) still shows its header in place. `index` on a row is its
 * position in `visibleTabs`, which is what the cursor indexes.
 */
export type RenderItem =
  | { kind: 'header'; groupId: number }
  | { kind: 'row'; tab: TabInfo; index: number };

function matchesFilter(tab: TabInfo, filter: string): boolean {
  const q = filter.trim().toLowerCase();
  if (!q) return true;
  return (
    tab.title.toLowerCase().includes(q) || tab.url.toLowerCase().includes(q)
  );
}

/**
 * Produce the ordered list items for the current state. Group headers come from
 * the canonical tab order; a collapsed group keeps its header but hides its
 * member rows. Row indices come straight from `visible`, whose order matches the
 * canonical tab order we walk here (same filter + collapse predicate).
 */
export function renderItems(
  state: ReviewUiState,
  visible: TabInfo[],
): RenderItem[] {
  const items: RenderItem[] = [];
  const headered = new Set<number>();
  const indexOf = new Map<number, number>();
  visible.forEach((t, i) => indexOf.set(t.id, i));

  for (const tab of state.tabs) {
    // A collapsed group's members are hidden but still count toward whether the
    // group matches the filter (so its header stays put).
    if (isGrouped(tab) && state.collapsed.has(tab.groupId)) {
      if (matchesFilter(tab, state.filter) && !headered.has(tab.groupId)) {
        items.push({ kind: 'header', groupId: tab.groupId });
        headered.add(tab.groupId);
      }
      continue;
    }
    if (!matchesFilter(tab, state.filter)) continue;
    if (isGrouped(tab) && !headered.has(tab.groupId)) {
      items.push({ kind: 'header', groupId: tab.groupId });
      headered.add(tab.groupId);
    }
    items.push({ kind: 'row', tab, index: indexOf.get(tab.id) ?? 0 });
  }
  return items;
}
