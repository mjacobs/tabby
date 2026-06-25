import { useLayoutEffect, useRef, useState } from 'preact/hooks';

import { clampMenuPosition, menuTarget } from '@/view/menu';
import type { ContextMenuState } from '@/view/useContextMenu';

interface ContextMenuProps {
  menu: ContextMenuState;
  /** Current close-marks, to resolve whether the target is a selection. */
  marked: ReadonlySet<number>;
  onCloseTabs: (ids: number[]) => void;
  onStashTabs: (ids: number[]) => void;
  onMarkTabs: (ids: number[]) => void;
  onUnmarkTabs: (ids: number[]) => void;
  onJump: (id: number) => void;
  /** Dismiss the menu (called after any action and on outside interaction). */
  onDismiss: () => void;
}

/**
 * The review-list right-click menu (kata rz1c). A fixed-position list of actions
 * that operate on the menu's target — the whole marked selection when opened
 * over a marked row, else just that one row (see menuTarget). After mount it
 * measures itself and clamps its position so it stays on-screen.
 */
export function ContextMenu({
  menu,
  marked,
  onCloseTabs,
  onStashTabs,
  onMarkTabs,
  onUnmarkTabs,
  onJump,
  onDismiss,
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });

  // Measure once mounted and flip back on-screen near an edge. jsdom reports a
  // 0×0 box, so this is a no-op there (the menu renders at the click point).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPos(
      clampMenuPosition(
        menu.x,
        menu.y,
        el.offsetWidth,
        el.offsetHeight,
        window.innerWidth,
        window.innerHeight,
      ),
    );
  }, [menu.x, menu.y, menu.tabId]);

  const target = menuTarget(menu.tabId, marked);
  const n = target.ids.length;
  const plural = n === 1 ? 'tab' : `${n} tabs`;

  // Each action runs against the resolved target ids, then dismisses the menu.
  const run = (fn: () => void) => () => {
    fn();
    onDismiss();
  };

  return (
    <div
      ref={ref}
      class="context-menu"
      role="menu"
      style={{ top: `${pos.y}px`, left: `${pos.x}px` }}
    >
      <button
        type="button"
        role="menuitem"
        class="ctx-item"
        onClick={run(() => onCloseTabs(target.ids))}
      >
        Close {plural}
      </button>
      <button
        type="button"
        role="menuitem"
        class="ctx-item"
        onClick={run(() => onStashTabs(target.ids))}
      >
        Stash &amp; close{n === 1 ? '' : ` ${n}`}
      </button>
      <button
        type="button"
        role="menuitem"
        class="ctx-item"
        onClick={run(() =>
          target.targetMarked
            ? onUnmarkTabs(target.ids)
            : onMarkTabs(target.ids),
        )}
      >
        {target.targetMarked ? 'Unmark' : 'Mark'}
        {n === 1 ? '' : ` ${n}`}
      </button>
      {target.single && (
        <button
          type="button"
          role="menuitem"
          class="ctx-item"
          onClick={run(() => onJump(target.ids[0]))}
        >
          Jump to tab
        </button>
      )}
    </div>
  );
}
