// The cleanup pipeline, end to end:
//   snapshot windows → build plan → record undo → execute → stash → open review.

import { buildCleanupPlan } from '@/core/buildCleanupPlan';
import { applyPlan, chromeDriver } from '@/background/executor';
import { snapshotWindows } from '@/background/snapshot';
import { stashReview } from '@/background/reviewStore';
import { logState } from '@/background/stateLog';
import { broadcast } from '@/shared/messages';
import { recordClosed } from '@/background/undo';
import { loadSettings } from '@/shared/settings';
import type { TabInfo } from '@/shared/types';

const REVIEW_PAGE = 'src/review/review.html';
const SIDE_PANEL_PAGE = 'src/sidepanel/sidepanel.html';

function reviewUrl(): string {
  return chrome.runtime.getURL(REVIEW_PAGE);
}

/** Open the review page, reusing an existing one if present. */
async function openReviewPage(): Promise<void> {
  const url = reviewUrl();
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((t) => t.url && t.url.startsWith(url));
  if (existing?.id != null) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId != null) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url });
}

/**
 * Of the predicted-empty windows, keep only those that still exist. Moving a
 * window's last tab away makes Chrome auto-close it, so by the time the review
 * renders, a planned-empty window is often already gone — offering to close it
 * yields a confusing "0 windows closed" (kata 0awf).
 */
export async function stillOpenWindowIds(ids: number[]): Promise<number[]> {
  const open: number[] = [];
  for (const id of ids) {
    try {
      await chrome.windows.get(id);
      open.push(id);
    } catch {
      // Already auto-closed.
    }
  }
  return open;
}

/** True if the user has granted the optional `sidePanel` permission. */
async function hasSidePanel(): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ permissions: ['sidePanel'] });
  } catch {
    return false;
  }
}

/**
 * Open the side panel in the given window. Returns false if the side panel
 * API isn't available or the open call fails — caller falls back to the page.
 */
async function openSidePanel(windowId: number | undefined): Promise<boolean> {
  if (windowId == null) return false;
  if (typeof chrome.sidePanel === 'undefined') return false;
  try {
    await chrome.sidePanel.setOptions({ path: SIDE_PANEL_PAGE, enabled: true });
    await chrome.sidePanel.open({ windowId });
    return true;
  } catch {
    return false;
  }
}

export interface RunCleanupOptions {
  /** Window the trigger fired in — passed to chrome.sidePanel.open. */
  windowId?: number;
}

/** Run the full consolidate → dedup → sort pipeline, then open the review. */
export async function runCleanup(opts: RunCleanupOptions = {}): Promise<void> {
  const settings = await loadSettings();
  const windows = await snapshotWindows(reviewUrl());
  await logState('orchestrator:before', { windows, settings });
  const plan = buildCleanupPlan({ windows, settings });

  // Gather the auto-dedup/purge closes so we can record them for undo.
  const byId = new Map<number, TabInfo>();
  for (const w of windows) for (const t of w.tabs) byId.set(t.id, t);
  const closing = plan.closeTabIds
    .map((id) => byId.get(id))
    .filter((t): t is TabInfo => t != null);

  const targetWindowId = await applyPlan(plan, chromeDriver);

  // Record after applying so the just-closed tabs are in chrome.sessions and
  // undo can restore them with history (see undo.ts).
  if (closing.length) await recordClosed(closing);

  await stashReview({
    reviewTabs: plan.reviewTabs,
    targetWindowId,
    closedCount: plan.closeTabIds.length,
    emptyWindowIds: await stillOpenWindowIds(plan.emptyWindowIds),
    stayingPinnedTabIds: plan.stayingPinnedTabIds,
    confirmBeforeCommit: settings.confirmBeforeCommit,
    generatedAt: Date.now(),
  });

  await logState('orchestrator:after', { settings });

  // Push the fresh stash to any review page that mounted before this run, so
  // re-triggering in a window with the review already open updates it in place
  // instead of showing the stale snapshot (kata#zpsb).
  broadcast({ type: 'reviewUpdated' });

  const wantSidePanel =
    settings.preferredSurface === 'sidepanel' && (await hasSidePanel());
  if (wantSidePanel && (await openSidePanel(opts.windowId))) return;
  await openReviewPage();
}
