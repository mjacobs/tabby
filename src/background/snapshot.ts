// Bridges Chrome's tab model into Tabby's pure `TabInfo`. The mapping function
// is pure (takes a plain tab-shaped object) so it's unit-testable; the snapshot
// function around it is the only place that touches chrome.windows.

import type { WindowSnapshot } from '@/core/buildCleanupPlan';
import type { TabInfo } from '@/shared/types';

/** Map a chrome.tabs.Tab onto Tabby's TabInfo. Pure. */
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
  };
}

/**
 * Snapshot every normal window's tabs as WindowSnapshots, excluding Tabby's own
 * review page so the cleanup never moves or closes it.
 */
export async function snapshotWindows(
  reviewUrl: string,
): Promise<WindowSnapshot[]> {
  const windows = await chrome.windows.getAll({
    populate: true,
    windowTypes: ['normal'],
  });

  return windows
    .filter((w) => w.id != null)
    .map((w) => ({
      id: w.id!,
      focused: w.focused,
      tabs: (w.tabs ?? [])
        .filter((t) => t.id != null && t.url !== reviewUrl)
        .map(tabInfoFromChromeTab),
    }));
}
