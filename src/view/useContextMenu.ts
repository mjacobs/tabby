import { useEffect, useState } from 'preact/hooks';

/** An open context menu: where it opened and which row's tab it opened over. */
export interface ContextMenuState {
  x: number;
  y: number;
  tabId: number;
}

interface ContextMenuApi {
  menu: ContextMenuState | null;
  /** Attach to the list surface: opens the menu over a row, suppressing Chrome's. */
  onContextMenu: (e: MouseEvent) => void;
  close: () => void;
}

/**
 * The review list's right-click menu plumbing (kata rz1c). A right-click over a
 * row opens a Tabby menu (and suppresses the browser's default page menu); a
 * right-click on empty space is left alone. While open, the menu closes on an
 * outside press, Escape, scroll, or resize. The DOM-event handling lives here so
 * ReviewView only renders the menu and wires its actions — mirroring useMarquee.
 */
export function useContextMenu(): ContextMenuApi {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const close = () => setMenu(null);

  const onContextMenu = (e: MouseEvent) => {
    const row = (e.target as Element).closest('.row');
    const idAttr = row?.getAttribute('data-tab-id');
    // Only intercept right-clicks that land on a row; elsewhere, let the
    // browser's default menu through.
    if (idAttr == null) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, tabId: Number(idAttr) });
  };

  // While open, dismiss on the next outside interaction. Listeners are capture
  // phase so they run before (and can preempt) the row/keymap handlers; the
  // Escape handler stops propagation so it doesn't also fire the global keymap.
  useEffect(() => {
    if (!menu) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (!(e.target as Element).closest('.context-menu')) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        close();
      }
    };
    const onReflow = () => close();
    document.addEventListener('mousedown', onDocMouseDown, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('scroll', onReflow, true);
    window.addEventListener('resize', onReflow, true);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('scroll', onReflow, true);
      window.removeEventListener('resize', onReflow, true);
    };
  }, [menu]);

  return { menu, onContextMenu, close };
}
