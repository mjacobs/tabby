// Worker-side handlers for ViewRequests. Registered once from index.ts.

import { tabInfoFromChromeTab } from '@/background/snapshot';
import { getReview } from '@/background/reviewStore';
import { runCleanup } from '@/background/orchestrator';
import { dumpState, logState } from '@/background/stateLog';
import { recordClosed, undoLast } from '@/background/undo';
import { coerceSettings, loadSettings, saveSettings } from '@/shared/settings';
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
  // Capture tab info for undo before removing (the tabs still exist here).
  const infos: TabInfo[] = [];
  for (const id of tabIds) {
    try {
      infos.push(tabInfoFromChromeTab(await chrome.tabs.get(id)));
    } catch {
      // Already gone — nothing to record.
    }
  }
  try {
    await chrome.tabs.remove(tabIds);
  } catch {
    // Best-effort; some ids may already be closed.
  }
  // Record after removal so the closed tabs are in chrome.sessions and undo can
  // restore them with history (see undo.ts).
  await recordClosed(infos);
  await logState('commitClose');
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

async function exportSettings(): Promise<ViewResponse['exportSettings']> {
  return { settings: await loadSettings() };
}

async function importSettings(
  input: unknown,
): Promise<ViewResponse['importSettings']> {
  const { settings, warnings } = coerceSettings(input);
  await saveSettings(settings);
  return { ok: true, warnings };
}

async function dispatch(msg: ViewRequest): Promise<unknown> {
  switch (msg.type) {
    case 'getReview':
      return getReview();
    case 'jumpTo':
      return jumpTo(msg.tabId);
    case 'commitClose':
      return commitClose(msg.tabIds);
    case 'undo': {
      const restored = await undoLast();
      await logState('undo');
      return { restored };
    }
    case 'closeEmptyWindows':
      return closeEmptyWindows(msg.windowIds);
    case 'runCleanup':
      await runCleanup();
      return { ok: true };
    case 'exportSettings':
      return exportSettings();
    case 'importSettings':
      return importSettings(msg.settings);
    case 'dumpState':
      return dumpState();
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
