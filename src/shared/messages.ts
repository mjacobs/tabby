// Typed message contract between the background worker and the review view.
// Pure types + a view-safe send helper — no Chrome tab APIs, so the view can
// import this without pulling in worker-only code.

import type { Settings, TabInfo } from '@/shared/types';

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

// --- Canonical state-log types (vpn4) — pure data, kept here so messages.ts
// stays view-safe (importing them never pulls in worker-only chrome glue). ----

/** One tab in a canonical snapshot — stable field set for meaningful diffs. */
export interface CanonicalTab {
  id: number;
  index: number;
  windowId: number;
  pinned: boolean;
  groupId?: number;
  active: boolean;
  lastAccessed?: number;
  urlRaw: string;
  urlNormalized: string;
  title: string;
}

export interface CanonicalWindow {
  id: number;
  focused: boolean;
  tabs: CanonicalTab[];
}

/** A point-in-time canonical snapshot tagged with the operation boundary. */
export interface CanonicalSnapshot {
  /** Operation boundary, e.g. 'orchestrator:before', 'commitClose'. */
  label: string;
  /** ms epoch when captured. */
  capturedAt: number;
  /** Live windows/tabs, deterministically ordered (windows by id, tabs by index). */
  windows: CanonicalWindow[];
  /** The ReviewState the view is currently showing, to tie live tabs to the UI. */
  review: ReviewState | null;
}

/** Result of the `dumpState` message: live state plus the retained buffer. */
export interface StateDump {
  current: CanonicalSnapshot;
  buffer: CanonicalSnapshot[];
}

/** Requests the view sends to the worker. */
export type ViewRequest =
  | { type: 'getReview' }
  | { type: 'jumpTo'; tabId: number }
  | { type: 'commitClose'; tabIds: number[] }
  | { type: 'undo' }
  | { type: 'closeEmptyWindows'; windowIds: number[] }
  // Control surface (t8k5) — lets a script/agent drive Tabby without the UI.
  | { type: 'runCleanup' }
  | { type: 'exportSettings' }
  | { type: 'importSettings'; settings: unknown }
  // Debug/observability (vpn4) — read canonical state without DevTools.
  | { type: 'dumpState' };

/** Response shape per request type. */
export interface ViewResponse {
  getReview: ReviewState | null;
  jumpTo: { ok: boolean };
  commitClose: { closed: number };
  undo: { restored: number };
  closeEmptyWindows: { closed: number };
  runCleanup: { ok: boolean };
  exportSettings: { settings: Settings };
  importSettings: { ok: boolean; warnings: string[] };
  dumpState: StateDump;
}

/** Send a typed request to the worker and get its typed response. */
export function sendRequest<K extends ViewRequest['type']>(
  req: Extract<ViewRequest, { type: K }>,
): Promise<ViewResponse[K]> {
  return chrome.runtime.sendMessage(req) as Promise<ViewResponse[K]>;
}
