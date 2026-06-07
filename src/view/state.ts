// Pure review-list state: cursor, close-marks, filter, visual-range, help.
// No DOM, no Chrome — every keyboard interaction is a reducer action, so the
// whole interaction model is unit-testable without rendering anything.

import type { TabInfo } from '@/shared/types';

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
}

export type Action =
  | { type: 'load'; tabs: TabInfo[] }
  | { type: 'move'; delta: number }
  | { type: 'moveTo'; to: 'top' | 'bottom' }
  | { type: 'toggleMark' }
  | { type: 'markAll' }
  | { type: 'clearMarks' }
  | { type: 'startVisual' }
  | { type: 'setFilter'; query: string }
  | { type: 'setFiltering'; on: boolean }
  | { type: 'removeTabs'; ids: number[] }
  | { type: 'updateTab'; id: number; title?: string; url?: string }
  | { type: 'toggleHelp' }
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
  };
}

/** Tabs matching the current filter, in order. */
export function visibleTabs(state: ReviewUiState): TabInfo[] {
  const q = state.filter.trim().toLowerCase();
  if (!q) return state.tabs;
  return state.tabs.filter(
    (t) =>
      t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q),
  );
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

    case 'escape':
      return { ...state, visualAnchor: null, showHelp: false };
  }
}
