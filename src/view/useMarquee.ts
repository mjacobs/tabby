import { useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';

import type { RenderItem } from '@/view/renderItems';
import type { Action } from '@/view/state';
import { rowsInBand, autoScrollStep } from '@/view/marquee';

/** Pixels the pointer must move before a press becomes a drag (vs a click). */
const DRAG_THRESHOLD = 5;
/** Distance from a viewport edge where a held drag starts auto-scrolling. */
const EDGE = 36;

const raf =
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number;
const cancelRaf =
  typeof cancelAnimationFrame === 'function'
    ? cancelAnimationFrame
    : (id: number) => clearTimeout(id);

interface MarqueeOpts {
  viewportRef: RefObject<HTMLDivElement>;
  items: RenderItem[];
  rowHeight: number;
  dispatch: (action: Action) => void;
}

interface MarqueeApi {
  onMouseDown: (e: MouseEvent) => void;
  onClickCapture: (e: MouseEvent) => void;
  band: { top: number; height: number } | null;
  pendingIds: ReadonlySet<number>;
}

/**
 * Drag-to-select over the review list. A press on the row area that moves past
 * the threshold becomes a vertical rubber-band; rows it covers preview as
 * pending and commit (additively) on release. Holding near an edge auto-scrolls
 * so the selection can run past the visible viewport. Geometry is in content
 * coordinates (item index × rowHeight), matching the virtualizer. (kata rxxe)
 */
export function useMarquee({
  viewportRef,
  items,
  rowHeight,
  dispatch,
}: MarqueeOpts): MarqueeApi {
  // Latest render values read by event handlers without re-binding listeners.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const rowHeightRef = useRef(rowHeight);
  rowHeightRef.current = rowHeight;

  const [band, setBand] = useState<{ top: number; height: number } | null>(null);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<number>>(new Set());
  // The pending set is also tracked in a ref, updated SYNCHRONOUSLY by recompute
  // — a mousedown→mousemove→mouseup burst fires with no render in between, so
  // onMouseUp must read the ref (not the state) to commit the right rows.
  const pendingIdsRef = useRef<ReadonlySet<number>>(new Set());

  // Drag bookkeeping (refs: mutated across raw DOM events, never rendered).
  const startContentY = useRef(0); // band anchor in content coords
  const startClientY = useRef(0); // for the click-vs-drag threshold
  const lastClientY = useRef(0); // latest pointer y (for auto-scroll recompute)
  const dragging = useRef(false);
  const suppressClick = useRef(false);
  const rafId = useRef<number | null>(null);

  const contentY = (clientY: number): number => {
    const el = viewportRef.current;
    if (!el) return clientY;
    const rect = el.getBoundingClientRect();
    return clientY - rect.top + el.scrollTop;
  };

  const recompute = () => {
    const cy = contentY(lastClientY.current);
    const lo = Math.min(startContentY.current, cy);
    const hi = Math.max(startContentY.current, cy);
    const next = new Set(rowsInBand(itemsRef.current, rowHeightRef.current, lo, hi));
    pendingIdsRef.current = next; // synchronous — read by onMouseUp's commit
    setBand({ top: lo, height: hi - lo });
    setPendingIds(next); // for the live preview render
  };

  const stopAutoScroll = () => {
    if (rafId.current != null) {
      cancelRaf(rafId.current);
      rafId.current = null;
    }
  };

  const tickAutoScroll = () => {
    rafId.current = null;
    const el = viewportRef.current;
    if (!dragging.current || !el) return;
    const vh = el.clientHeight;
    const pointerInViewport =
      lastClientY.current - el.getBoundingClientRect().top;
    const step = vh > 0 ? autoScrollStep(pointerInViewport, vh, EDGE) : 0;
    if (step !== 0) {
      const max = el.scrollHeight - el.clientHeight;
      el.scrollTop = Math.max(0, Math.min(max, el.scrollTop + step));
      recompute();
      rafId.current = raf(tickAutoScroll);
    }
  };

  const onMouseMove = (e: MouseEvent) => {
    lastClientY.current = e.clientY;
    if (!dragging.current) {
      if (Math.abs(e.clientY - startClientY.current) < DRAG_THRESHOLD) return;
      dragging.current = true; // promote press → drag
    }
    e.preventDefault(); // suppress text selection while dragging
    recompute();
    if (rafId.current == null) rafId.current = raf(tickAutoScroll);
  };

  const onMouseUp = () => {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    stopAutoScroll();
    document.body.classList.remove('dragging');
    if (dragging.current) {
      dispatch({ type: 'markIds', ids: [...pendingIdsRef.current] });
      suppressClick.current = true; // eat the trailing click from this drag
    }
    dragging.current = false;
    pendingIdsRef.current = new Set();
    setBand(null);
    setPendingIds(new Set());
  };

  const onMouseDown = (e: MouseEvent) => {
    // A fresh press always clears a stale suppress flag (e.g. a drag that ended
    // without a trailing click), so the next real click is never swallowed.
    suppressClick.current = false;
    if (e.button !== 0) return;
    const target = e.target as Element;
    // Let the checkbox and group headers keep their own click behavior.
    if (target.closest('.mark, .group-divider')) return;
    dragging.current = false;
    startClientY.current = e.clientY;
    lastClientY.current = e.clientY;
    startContentY.current = contentY(e.clientY);
    document.body.classList.add('dragging');
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // Capture-phase click eater: after a drag, swallow exactly one click so the
  // release doesn't also toggle a row (or follow a link). Capture runs before
  // the row's bubble-phase onClick, so stopping here cancels it.
  const onClickCapture = (e: MouseEvent) => {
    if (suppressClick.current) {
      e.preventDefault();
      e.stopPropagation();
      suppressClick.current = false;
    }
  };

  return { onMouseDown, onClickCapture, band, pendingIds };
}
