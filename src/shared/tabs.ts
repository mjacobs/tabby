import type { TabInfo } from '@/shared/types';

/** Chrome's sentinel for "no group". */
export const TAB_GROUP_ID_NONE = -1;

/** Map a chrome.tabs.Tab onto Tabby's TabInfo. Pure (no chrome.* calls). */
export function tabInfoFromChromeTab(tab: chrome.tabs.Tab): TabInfo {
  return {
    id: tab.id ?? -1,
    windowId: tab.windowId,
    index: tab.index,
    // url requires the "tabs" permission; pendingUrl covers not-yet-committed loads.
    url: tab.url || tab.pendingUrl || '',
    title: tab.title ?? '',
    pinned: tab.pinned,
    audible: tab.audible ?? false,
    active: tab.active,
    groupId: tab.groupId,
    lastAccessed: tab.lastAccessed,
    favIconUrl: tab.favIconUrl,
  };
}

/** True when the tab belongs to a real tab group. */
export function isGrouped(tab: TabInfo): tab is TabInfo & { groupId: number } {
  return tab.groupId != null && tab.groupId !== TAB_GROUP_ID_NONE;
}

/**
 * Deterministic original-position order: window, then strip index, then id.
 * Used as a stable tie-breaker so results never depend on input array order.
 */
export function byPosition(a: TabInfo, b: TabInfo): number {
  return a.windowId - b.windowId || a.index - b.index || a.id - b.id;
}
