// Pure review-list state: cursor, close-marks, filter, visual-range, help.
// No DOM, no Chrome — every keyboard interaction is a reducer action, so the
// whole interaction model is unit-testable without rendering anything.

import type { TabInfo } from '@/shared/types';
import { isGrouped, TAB_GROUP_ID_NONE } from '@/shared/tabs';

export interface ReviewUiState {
  tabs: TabInfo[];
  /** Cursor index into the *visible* (filtered) tabs. */
  cursor: number;
  /** Tab ids marked for closing. */
  marked: Set<number>;
  /** Case-insensitive substring filter over title + url. */
  filter: string;
  /** True while the filter input has focus (keys go to the input). */
  filtering: boolean;
  /** Visual-range anchor (a visible index), or null when not range-selecting. */
  visualAnchor: number | null;
  showHelp: boolean;
  /**
   * Group ids that are currently COLLAPSED (members hidden from the list).
   * Default empty = all expanded. Display-only and session-only: never
   * persisted, never affects header totals, marks, or commit. (kata#yrez)
   */
  collapsed: Set<number>;
}

export type Action =
  | { type: 'load'; tabs: TabInfo[] }
  | { type: 'sync'; tabs: TabInfo[] }
  | { type: 'move'; delta: number }
  | { type: 'moveTo'; to: 'top' | 'bottom' }
  | { type: 'toggleMark' }
  | { type: 'toggleMarkId'; id: number }
  | { type: 'markAll' }
  | { type: 'clearMarks' }
  | { type: 'startVisual' }
  | { type: 'setFilter'; query: string }
  | { type: 'setFiltering'; on: boolean }
  | { type: 'removeTabs'; ids: number[] }
  | { type: 'updateTab'; id: number; title?: string; url?: string }
  | { type: 'toggleHelp' }
  | { type: 'toggleCollapse'; groupId?: number }
  | { type: 'escape' };

export function initialState(tabs: TabInfo[]): ReviewUiState {
  return {
    tabs,
    cursor: 0,
    marked: new Set(),
    filter: '',
    filtering: false,
    visualAnchor: null,
    showHelp: false,
    collapsed: new Set(),
  };
}

/**
 * Tabs matching the current filter AND not hidden inside a collapsed group,
 * in order. The cursor indexes into this list, so j/k naturally skip the
 * members of a collapsed group. (kata#yrez)
 */
export function visibleTabs(state: ReviewUiState): TabInfo[] {
  const q = state.filter.trim().toLowerCase();
  return state.tabs.filter((t) => {
    if (isGrouped(t) && state.collapsed.has(t.groupId)) return false;
    if (!q) return true;
    return (
      t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q)
    );
  });
}

/** The tab under the cursor, or undefined when the visible list is empty. */
export function currentTab(state: ReviewUiState): TabInfo | undefined {
  return visibleTabs(state)[state.cursor];
}

function clampCursor(cursor: number, count: number): number {
  if (count === 0) return 0;
  return Math.max(0, Math.min(cursor, count - 1));
}

export function reduce(state: ReviewUiState, action: Action): ReviewUiState {
  switch (action.type) {
    case 'load':
      return initialState(action.tabs);

    case 'sync': {
      // Reconcile to live tabs without disturbing the user's interaction:
      // keep marks for tabs still present, clamp the cursor, preserve filter,
      // visual-range, and help. (kata#xtwp)
      const present = new Set(action.tabs.map((t) => t.id));
      const marked = new Set([...state.marked].filter((id) => present.has(id)));
      // Drop collapse state for groups that no longer exist in the window.
      const liveGroups = new Set(
        action.tabs.filter(isGrouped).map((t) => t.groupId),
      );
      const collapsed = new Set(
        [...state.collapsed].filter((g) => liveGroups.has(g)),
      );
      const next = { ...state, tabs: action.tabs, marked, collapsed };
      const count = visibleTabs(next).length;
      const visualAnchor =
        state.visualAnchor == null ? null : clampCursor(state.visualAnchor, count);
      return { ...next, cursor: clampCursor(state.cursor, count), visualAnchor };
    }

    case 'move': {
      const count = visibleTabs(state).length;
      return { ...state, cursor: clampCursor(state.cursor + action.delta, count) };
    }

    case 'moveTo': {
      const count = visibleTabs(state).length;
      return {
        ...state,
        cursor: action.to === 'top' ? 0 : clampCursor(count - 1, count),
      };
    }

    case 'toggleMark': {
      const visible = visibleTabs(state);
      // With a visual anchor set, toggleMark commits the range instead.
      if (state.visualAnchor != null) {
        const lo = Math.min(state.visualAnchor, state.cursor);
        const hi = Math.max(state.visualAnchor, state.cursor);
        const marked = new Set(state.marked);
        for (let i = lo; i <= hi; i++) {
          const tab = visible[i];
          if (tab) marked.add(tab.id);
        }
        return { ...state, marked, visualAnchor: null };
      }
      const current = visible[state.cursor];
      if (!current) return state;
      const marked = new Set(state.marked);
      if (marked.has(current.id)) marked.delete(current.id);
      else marked.add(current.id);
      return { ...state, marked };
    }

    case 'toggleMarkId': {
      // Mark a specific tab by id WITHOUT moving the cursor — used by the
      // mouse path (checkbox / advisory badge click), where hijacking the
      // keyboard cursor to the clicked row is jarring (kata 49m8). The cursor
      // is a keyboard-navigation concept; a click shouldn't move it.
      const marked = new Set(state.marked);
      if (marked.has(action.id)) marked.delete(action.id);
      else marked.add(action.id);
      return { ...state, marked };
    }

    case 'markAll': {
      const marked = new Set(state.marked);
      for (const t of visibleTabs(state)) marked.add(t.id);
      return { ...state, marked };
    }

    case 'clearMarks':
      return { ...state, marked: new Set() };

    case 'startVisual':
      return { ...state, visualAnchor: state.cursor };

    case 'setFilter': {
      const next = { ...state, filter: action.query };
      const count = visibleTabs(next).length;
      return { ...next, cursor: clampCursor(state.cursor, count) };
    }

    case 'setFiltering':
      return { ...state, filtering: action.on };

    case 'removeTabs': {
      const ids = new Set(action.ids);
      const tabs = state.tabs.filter((t) => !ids.has(t.id));
      const marked = new Set([...state.marked].filter((id) => !ids.has(id)));
      const next = { ...state, tabs, marked };
      const count = visibleTabs(next).length;
      return { ...next, cursor: clampCursor(state.cursor, count) };
    }

    case 'updateTab':
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.id
            ? {
                ...t,
                title: action.title ?? t.title,
                url: action.url ?? t.url,
              }
            : t,
        ),
      };

    case 'toggleHelp':
      return { ...state, showHelp: !state.showHelp };

    case 'toggleCollapse': {
      // Default target is the current row's group ('z' key); the header click
      // passes its own groupId explicitly.
      const groupId = action.groupId ?? currentTab(state)?.groupId;
      if (groupId == null || groupId === TAB_GROUP_ID_NONE) return state;
      const collapsed = new Set(state.collapsed);
      if (collapsed.has(groupId)) collapsed.delete(groupId);
      else collapsed.add(groupId);
      // Keep the cursor on a still-visible row. After collapsing the group the
      // cursor sat in, it would otherwise point past the (now shorter) list.
      const next = { ...state, collapsed };
      const count = visibleTabs(next).length;
      return { ...next, cursor: clampCursor(state.cursor, count) };
    }

    case 'escape':
      return { ...state, visualAnchor: null, showHelp: false };
  }
}
