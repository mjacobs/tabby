// Pure key → intent mapping. An Intent is either a reducer Action (state-only)
// or a Command the view executes against the transport (jump/commit/undo) or
// the DOM (focusFilter). Keeping this pure makes the keyboard map testable
// without a browser.

import type { Action } from '@/view/state';

export type Intent =
  | Action
  | { type: 'jump' }
  | { type: 'commit' }
  | { type: 'undo' }
  | { type: 'focusFilter' };

/** Minimal shape of a KeyboardEvent so tests don't need a real event. */
export interface KeyEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

/**
 * Map a keypress to an intent. `filtering` is true when the filter input has
 * focus, in which case typing flows to the input and only Enter/Escape act.
 */
export function keymap(e: KeyEventLike, filtering: boolean): Intent | null {
  if (filtering) {
    if (e.key === 'Enter' || e.key === 'Escape') {
      return { type: 'setFiltering', on: false };
    }
    return null;
  }

  const mod = e.ctrlKey || e.metaKey;

  switch (e.key) {
    case 'j':
    case 'ArrowDown':
      return { type: 'move', delta: 1 };
    case 'k':
    case 'ArrowUp':
      return { type: 'move', delta: -1 };
    case 'g':
    case 'Home':
      return { type: 'moveTo', to: 'top' };
    case 'G':
    case 'End':
      return { type: 'moveTo', to: 'bottom' };
    case 'x':
    case 'd':
    case ' ':
      return { type: 'toggleMark' };
    case 'V':
      return { type: 'startVisual' };
    case 'a':
      return { type: 'markAll' };
    case 'A':
      return { type: 'clearMarks' };
    case '/':
      return { type: 'focusFilter' };
    case 'u':
      return { type: 'undo' };
    case '?':
      return { type: 'toggleHelp' };
    case 'Escape':
      return { type: 'escape' };
    case 'Enter':
      return mod ? { type: 'commit' } : { type: 'jump' };
    default:
      return null;
  }
}
