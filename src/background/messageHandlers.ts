// Worker-side handlers for ViewRequests. Registered once from index.ts.

import { tabInfoFromChromeTab } from '@/background/snapshot';
import { getReview } from '@/background/reviewStore';
import { recordClosed, undoLast } from '@/background/undo';
import type { TabInfo } from '@/shared/types';
import type { ViewRequest, ViewResponse } from '@/shared/messages';

async function jumpTo(tabId: number): Promise<ViewResponse['jumpTo']> {
  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab?.windowId != null) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

async function commitClose(
  tabIds: number[],
): Promise<ViewResponse['commitClose']> {
  // Capture tab info for undo before removing.
  const infos: TabInfo[] = [];
  for (const id of tabIds) {
    try {
      infos.push(tabInfoFromChromeTab(await chrome.tabs.get(id)));
    } catch {
      // Already gone — nothing to record.
    }
  }
  await recordClosed(infos);
  try {
    await chrome.tabs.remove(tabIds);
  } catch {
    // Best-effort; some ids may already be closed.
  }
  return { closed: infos.length };
}

async function closeEmptyWindows(
  windowIds: number[],
): Promise<ViewResponse['closeEmptyWindows']> {
  let closed = 0;
  for (const id of windowIds) {
    try {
      await chrome.windows.remove(id);
      closed++;
    } catch {
      // Window already gone.
    }
  }
  return { closed };
}

async function dispatch(msg: ViewRequest): Promise<unknown> {
  switch (msg.type) {
    case 'getReview':
      return getReview();
    case 'jumpTo':
      return jumpTo(msg.tabId);
    case 'commitClose':
      return commitClose(msg.tabIds);
    case 'undo':
      return { restored: await undoLast() };
    case 'closeEmptyWindows':
      return closeEmptyWindows(msg.windowIds);
  }
}

export function registerMessageHandlers(): void {
  chrome.runtime.onMessage.addListener((msg: ViewRequest, _sender, respond) => {
    dispatch(msg)
      .then(respond)
      .catch(() => respond(undefined));
    return true; // keep the channel open for the async response
  });
}
