// The cleanup pipeline, end to end:
//   snapshot windows → build plan → record undo → execute → stash → open review.

import { buildCleanupPlan } from '@/core/buildCleanupPlan';
import { applyPlan, chromeDriver } from '@/background/executor';
import { snapshotWindows } from '@/background/snapshot';
import { stashReview } from '@/background/reviewStore';
import { recordClosed } from '@/background/undo';
import { loadSettings } from '@/shared/settings';
import type { TabInfo } from '@/shared/types';

const REVIEW_PAGE = 'src/review/review.html';

function reviewUrl(): string {
  return chrome.runtime.getURL(REVIEW_PAGE);
}

/** Open the review page, reusing an existing one if present. */
async function openReview(): Promise<void> {
  const url = reviewUrl();
  const [existing] = await chrome.tabs.query({ url });
  if (existing?.id != null) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId != null) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url });
}

/** Run the full consolidate → dedup → sort pipeline, then open the review. */
export async function runCleanup(): Promise<void> {
  const settings = await loadSettings();
  const windows = await snapshotWindows(reviewUrl());
  const plan = buildCleanupPlan({ windows, settings });

  // Record the auto-dedup/purge closes for undo before we apply them.
  const byId = new Map<number, TabInfo>();
  for (const w of windows) for (const t of w.tabs) byId.set(t.id, t);
  const closing = plan.closeTabIds
    .map((id) => byId.get(id))
    .filter((t): t is TabInfo => t != null);
  if (closing.length) await recordClosed(closing);

  await applyPlan(plan, chromeDriver);

  await stashReview({
    reviewTabs: plan.reviewTabs,
    closedCount: plan.closeTabIds.length,
    emptyWindowIds: plan.emptyWindowIds,
    stayingPinnedTabIds: plan.stayingPinnedTabIds,
    confirmBeforeCommit: settings.confirmBeforeCommit,
    generatedAt: Date.now(),
  });

  await openReview();
}
