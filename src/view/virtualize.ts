// Pure windowing math for the virtualized review list.
//
// The review list can hold 500+ rows; rendering every <li> makes scrolling and
// keyboard navigation janky. We render only the slice of items intersecting the
// viewport (plus an overscan margin) and pad the top/bottom with spacer rows so
// the scrollbar still reflects the full list height.
//
// Items (rows AND group dividers) are treated as a single uniform height — see
// src/view/review.css; they are all single-line. Keeping this pure makes it
// unit-testable under jsdom, which has no real layout.

export interface Window {
  /** First item index to render (inclusive). */
  start: number;
  /** One past the last item index to render (exclusive). */
  end: number;
  /** Spacer height above the rendered slice, in px. */
  padTop: number;
  /** Spacer height below the rendered slice, in px. */
  padBottom: number;
}

/**
 * Compute which slice of `itemCount` uniform-height items to render given the
 * current scroll position and viewport size.
 *
 * @param itemCount     total number of items in the list
 * @param scrollTop     scroll offset of the viewport, in px
 * @param viewportHeight visible height of the viewport, in px
 * @param rowHeight     height of a single item, in px (must be > 0)
 * @param overscan      extra items to render above & below the visible range
 */
export function computeWindow(
  itemCount: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan: number,
): Window {
  if (itemCount <= 0 || rowHeight <= 0) {
    return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  }

  const clampedScroll = Math.max(0, scrollTop);
  const visibleH = Math.max(0, viewportHeight);

  const firstVisible = Math.floor(clampedScroll / rowHeight);
  // +1 to cover a partially-scrolled final row, then +1 for the exclusive end.
  const lastVisible = Math.ceil((clampedScroll + visibleH) / rowHeight);

  const start = Math.max(0, firstVisible - overscan);
  const end = Math.min(itemCount, lastVisible + overscan);

  return {
    start,
    end,
    padTop: start * rowHeight,
    padBottom: (itemCount - end) * rowHeight,
  };
}

/**
 * Given a target item index, the current scroll position, and the viewport,
 * return the scrollTop that brings the item fully into view — or `null` if it
 * is already visible (nothing to do).
 *
 * Used to keep the cursor row on screen when j/k/gg/G move it past the window.
 */
export function scrollToShow(
  index: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
): number | null {
  if (rowHeight <= 0) return null;
  const top = index * rowHeight;
  const bottom = top + rowHeight;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewportHeight) {
    return bottom - viewportHeight;
  }
  return null;
}
