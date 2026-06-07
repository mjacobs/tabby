// Typed message contract between the background worker and the review view.
// Pure types + a view-safe send helper — no Chrome tab APIs, so the view can
// import this without pulling in worker-only code.

import type { TabInfo } from '@/shared/types';

/** Snapshot of a completed cleanup, stashed for the review view to render. */
export interface ReviewState {
  /** Surviving tabs in the target window, in final sorted order. */
  reviewTabs: TabInfo[];
  /** How many tabs the auto-dedup/purge stage closed. */
  closedCount: number;
  /** Non-target windows the cleanup emptied (offer to close). */
  emptyWindowIds: number[];
  /** Protected pinned tabs left behind in other windows. */
  stayingPinnedTabIds: number[];
  /** Whether to confirm before closing marked tabs (from settings). */
  confirmBeforeCommit: boolean;
  /** ms epoch when this cleanup ran. */
  generatedAt: number;
}

/** Requests the view sends to the worker. */
export type ViewRequest =
  | { type: 'getReview' }
  | { type: 'jumpTo'; tabId: number }
  | { type: 'commitClose'; tabIds: number[] }
  | { type: 'undo' }
  | { type: 'closeEmptyWindows'; windowIds: number[] };

/** Response shape per request type. */
export interface ViewResponse {
  getReview: ReviewState | null;
  jumpTo: { ok: boolean };
  commitClose: { closed: number };
  undo: { restored: number };
  closeEmptyWindows: { closed: number };
}

/** Send a typed request to the worker and get its typed response. */
export function sendRequest<K extends ViewRequest['type']>(
  req: Extract<ViewRequest, { type: K }>,
): Promise<ViewResponse[K]> {
  return chrome.runtime.sendMessage(req) as Promise<ViewResponse[K]>;
}
