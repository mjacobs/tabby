// Stash for the latest cleanup result, in chrome.storage.session. The
// orchestrator writes it after a run; the review view reads it via the
// 'getReview' message.

import type { ReviewState } from '@/shared/messages';

const REVIEW_KEY = 'tabby:review';

export async function stashReview(state: ReviewState): Promise<void> {
  await chrome.storage.session.set({ [REVIEW_KEY]: state });
}

export async function getReview(): Promise<ReviewState | null> {
  const stored = await chrome.storage.session.get(REVIEW_KEY);
  return (stored[REVIEW_KEY] as ReviewState | undefined) ?? null;
}
