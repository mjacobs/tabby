// Snapshots Chrome's windows into Tabby's pure `WindowSnapshot`s. The pure
// chrome.tabs.Tab → TabInfo mapping lives in shared/tabs.ts (so the view can
// reuse it); this module is the only place that touches chrome.windows.

import type { WindowSnapshot } from '@/core/buildCleanupPlan';
import { tabInfoFromChromeTab } from '@/shared/tabs';

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
