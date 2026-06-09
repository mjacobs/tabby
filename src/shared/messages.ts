// Typed message contract between the background worker and the review view.
// Pure types + a view-safe send helper — no Chrome tab APIs, so the view can
// import this without pulling in worker-only code.

import type { Settings, TabInfo } from '@/shared/types';
import type { Recommendation } from '@/core/recommend';

/** Snapshot of a completed cleanup, stashed for the review view to render. */
export interface ReviewState {
  /** Surviving tabs in the target window, in final sorted order. */
  reviewTabs: TabInfo[];
  /** The consolidated window the review mirrors live (kata#xtwp). */
  targetWindowId: number;
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

// --- Records-log types (e6f0) — pure data, kept here so messages.ts stays
// view-safe (the background imports these; no chrome types leak in). The records
// log is a persistent, capped trail of what Tabby recommended/closed and why,
// plus an opt-in navigation trace whose 'nav' entries seed the stranded-auth
// pattern set (see docs/close-recommendation-design.md, signal 1). ------------

/**
 * One entry in the persistent records log. Discriminated by `kind`; every entry
 * carries `at` (ms epoch). Pure data — safe for the view to render.
 */
export type RecordEntry = { at: number } & (
  | { kind: 'recommendation'; tabId: number; url: string; reasons: string[] }
  | { kind: 'close'; tabIds: number[]; urls: string[] }
  | { kind: 'undo'; restored: number }
  | {
      kind: 'nav';
      tabId: number;
      fromUrl: string;
      toUrl: string;
      transitionType: string;
      qualifiers: string[];
    }
);

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
  | { type: 'dumpState' }
  // Close-recommendation flags (9kb5) — advisory only; the worker computes
  // them because bookmark lookup needs chrome.bookmarks.
  | { type: 'getRecommendations'; tabs: TabInfo[] }
  // Records log (e6f0) — read/clear the persistent recommend/close/nav trail.
  | { type: 'getRecords' }
  | { type: 'clearRecords' };

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
  getRecommendations: { recommendations: Recommendation[] };
  getRecords: { records: RecordEntry[] };
  clearRecords: { ok: boolean };
}

/** Send a typed request to the worker and get its typed response. */
export function sendRequest<K extends ViewRequest['type']>(
  req: Extract<ViewRequest, { type: K }>,
): Promise<ViewResponse[K]> {
  return chrome.runtime.sendMessage(req) as Promise<ViewResponse[K]>;
}

/**
 * One-way broadcasts from the worker to any open review page (no response).
 * 'reviewUpdated' tells an already-mounted review page to re-fetch the stash,
 * so a fresh cleanup reaches a page that loaded before the run (kata#zpsb).
 */
export type WorkerBroadcast = { type: 'reviewUpdated' };

/** Fire-and-forget broadcast; ignores the "no receiver" error when no page is open. */
export function broadcast(msg: WorkerBroadcast): void {
  void chrome.runtime.sendMessage(msg).catch(() => {});
}
