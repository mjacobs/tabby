import type { TabInfo } from '@/shared/types';

/** Chrome's sentinel for "no group". */
export const TAB_GROUP_ID_NONE = -1;

/** True when the tab belongs to a real tab group. */
export function isGrouped(tab: TabInfo): boolean {
  return tab.groupId != null && tab.groupId !== TAB_GROUP_ID_NONE;
}

/**
 * Deterministic original-position order: window, then strip index, then id.
 * Used as a stable tie-breaker so results never depend on input array order.
 */
export function byPosition(a: TabInfo, b: TabInfo): number {
  return a.windowId - b.windowId || a.index - b.index || a.id - b.id;
}
