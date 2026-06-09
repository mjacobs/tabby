// Shared domain types. Kept free of Chrome API types so `core/` stays pure and
// unit-testable; the background layer maps `chrome.tabs.Tab` onto these.

/** The subset of tab data Tabby's core logic reasons about. */
export interface TabInfo {
  id: number;
  windowId: number;
  index: number;
  url: string;
  title: string;
  pinned: boolean;
  audible: boolean;
  /** The active (foreground) tab of its window. Never closed — see dedupe. */
  active: boolean;
  /** chrome.tabs.TAB_ID_NONE-safe group id, or undefined when ungrouped. */
  groupId?: number;
  /** ms epoch of last activation; used by the keep-most-recent policy. */
  lastAccessed?: number;
  /** Display-only favicon URL; ignored by core logic. */
  favIconUrl?: string;
}

/** Which copy survives within a duplicate group. */
export type KeepPolicy = 'most-recent' | 'oldest' | 'leftmost';

/** Where consolidated tabs land. */
export type ConsolidateTarget = 'focused-window' | 'new-window';

/**
 * What to do with blank/empty tabs (about:blank, new-tab pages, empty URL).
 * Note: these mirror the internal dedup modes of the same name, so the value
 * can be used directly as a mode. An active blank tab is never closed.
 *   - 'purge':    close blank tabs as clutter (except active ones)
 *   - 'collapse': treat all blanks as duplicates, keep one (prefer active)
 *   - 'protect':  set blanks aside, never close
 */
export type BlankTabPolicy = 'purge' | 'collapse' | 'protect';

/** User-tunable behavior, persisted in chrome.storage.sync. */
export interface Settings {
  normalize: {
    dropFragment: boolean;
    stripTrackingParams: boolean;
    dropTrailingSlash: boolean;
    ignoreWww: boolean;
    stripAllQuery: boolean;
    /** Extra tracking-param patterns (supports `prefix*` globs). */
    trackingParams: string[];
  };
  keepPolicy: KeepPolicy;
  protectPinned: boolean;
  protectAudible: boolean;
  blankTabPolicy: BlankTabPolicy;
  preserveGroups: boolean;
  consolidateTarget: ConsolidateTarget;
  confirmBeforeCommit: boolean;
  /**
   * Advisory close-recommendation signals (9kb5): per-signal toggles plus a
   * per-domain opt-out. Flags are always advisory — nothing is auto-closed.
   */
  recommend: {
    /** Flag tabs whose URL is already bookmarked. */
    bookmarked: boolean;
    /** Flag tabs stranded on a login/challenge page. */
    strandedAuth: boolean;
    /** Domains never flagged (matches the host or any subdomain of it). */
    excludedDomains: string[];
  };
  /**
   * Emit structured canonical tab-state snapshots at operation boundaries (to
   * console.debug + a session ring buffer readable via the `dumpState` message).
   * Off by default; a debugging/testing aid, not user-facing behavior.
   */
  debugLogging: boolean;
  /**
   * Record main-frame navigation events ('nav' entries) to the persistent
   * records log. Off by default; opt-in trace mode whose log is harvested to
   * build the stranded-auth URL pattern set (signal 1, kata e6f0).
   */
  traceNavigation: boolean;
}
