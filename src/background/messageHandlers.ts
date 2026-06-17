// Worker-side handlers for ViewRequests. Registered once from index.ts.

import { tabInfoFromChromeTab } from '@/shared/tabs';
import { getBookmarkedUrlSet } from '@/background/bookmarks';
import { getReview } from '@/background/reviewStore';
import { recommendClosures } from '@/core/recommend';
import { runCleanup } from '@/background/orchestrator';
import { dumpState, logState } from '@/background/stateLog';
import {
  appendRecords,
  buildCloseRecord,
  buildRecommendationRecords,
  buildUndoRecord,
  clearRecords,
  getRecords,
} from '@/background/records';
import { recordClosed, undoLast } from '@/background/undo';
import { bumpUsage, clearUsage, getUsage } from '@/background/usage';
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
  await appendRecords([buildCloseRecord(infos, Date.now())]);
  await logState('commitClose');
  // Fire-and-forget local tally; never let counting break the close (g6gb).
  void bumpUsage('tabsClosed', infos.length).catch(() => {});
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

async function getRecommendations(
  tabs: TabInfo[],
): Promise<ViewResponse['getRecommendations']> {
  const settings = await loadSettings();
  const bookmarkedUrls = settings.recommend.bookmarked
    ? await getBookmarkedUrlSet(settings.normalize)
    : new Set<string>();
  const recommendations = recommendClosures(tabs, {
    bookmarkedUrls,
    normalize: settings.normalize,
    options: settings.recommend,
  });
  await appendRecords(buildRecommendationRecords(recommendations, tabs, Date.now()));
  // Fire-and-forget local tally: one 'shown' per run, plus the flagged count
  // (a no-op write when nothing was flagged). Never breaks the request (g6gb).
  void bumpUsage('recommendationsShown').catch(() => {});
  void bumpUsage('recommendationsFlagged', recommendations.length).catch(() => {});
  return { recommendations };
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
      await appendRecords([buildUndoRecord(restored, Date.now())]);
      await logState('undo');
      // Fire-and-forget local tally; never let counting break the undo (g6gb).
      void bumpUsage('undo').catch(() => {});
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
    case 'getRecommendations':
      return getRecommendations(msg.tabs);
    case 'getRecords':
      return { records: await getRecords() };
    case 'clearRecords':
      await clearRecords();
      return { ok: true };
    case 'getUsage':
      return { counts: await getUsage() };
    case 'clearUsage':
      await clearUsage();
      return { ok: true };
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
