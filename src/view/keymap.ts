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

/** How long (ms) to wait for a second 'g' before cancelling the sequence. */
const GG_TIMEOUT_MS = 400;

/**
 * Create a stateful keymap handler that supports the vim-style two-key 'gg'
 * sequence (jump to top). Returns a function with the same signature as the
 * original `keymap` helper so callers need no changes.
 *
 * Sequence rules:
 *  - 'g'         → jump to top immediately (alias; keeps existing behaviour)
 *  - 'g' then 'g' within ~400 ms → also jump to top (harmless re-jump)
 *  - 'g' then any non-g key → cancel pending sequence; handle the new key normally
 *  - Timeout expiry → cancel pending sequence (no jump)
 */
export function createKeymap(
  setTimeout_: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = setTimeout,
  clearTimeout_: (id: ReturnType<typeof setTimeout>) => void = clearTimeout,
): (e: KeyEventLike, filtering: boolean) => Intent | null {
  let pendingG = false;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelPending(): void {
    pendingG = false;
    if (pendingTimer !== null) {
      clearTimeout_(pendingTimer);
      pendingTimer = null;
    }
  }

  return function handleKey(e: KeyEventLike, filtering: boolean): Intent | null {
    if (filtering) {
      if (e.key === 'Enter' || e.key === 'Escape') {
        return { type: 'setFiltering', on: false };
      }
      return null;
    }

    const mod = e.ctrlKey || e.metaKey;

    // Handle pending 'g' sequence: a second 'g' within the window re-jumps
    // to top (harmless since we're already there from the first press). Any
    // other key cancels the sequence and falls through to normal handling.
    if (pendingG) {
      cancelPending();
      if (e.key === 'g') {
        return { type: 'moveTo', to: 'top' };
      }
      // Fall through — handle this key normally.
    }

    switch (e.key) {
      case 'j':
      case 'ArrowDown':
        return { type: 'move', delta: 1 };
      case 'k':
      case 'ArrowUp':
        return { type: 'move', delta: -1 };
      case 'g':
      case 'Home': {
        // Jump to top immediately (single-g alias keeps existing behaviour).
        // Also arm the pending-g state so a second 'g' within the window is
        // treated as the canonical gg sequence (re-jump is harmless).
        if (e.key === 'g') {
          pendingG = true;
          pendingTimer = setTimeout_(() => {
            pendingG = false;
            pendingTimer = null;
          }, GG_TIMEOUT_MS);
        }
        return { type: 'moveTo', to: 'top' };
      }
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
  };
}

/**
 * Default module-level keymap instance used by ReviewView.
 * Exported as `keymap` so existing callers need no changes.
 */
export const keymap = createKeymap();
