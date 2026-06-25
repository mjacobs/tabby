// Pure logic for the row right-click context menu. No DOM: the target
// resolution and on-screen clamping are unit-testable without rendering. (rz1c)

/** What a context menu opened over a given row acts on. */
export interface MenuTarget {
  /** Tab ids the menu's actions apply to. */
  ids: number[];
  /** True when the target is exactly one tab (gates the "Jump to tab" item). */
  single: boolean;
  /**
   * True when the clicked row was already marked — i.e. the target is the whole
   * marked selection. Flips the menu's Mark/Unmark label and action.
   */
  targetMarked: boolean;
}

/**
 * Resolve what a context menu opened over `clickedId` should act on, using
 * file-manager semantics: right-clicking a row that is part of the selection
 * acts on the whole selection; right-clicking a row outside it acts on just
 * that row (and never silently rewrites the marks).
 */
export function menuTarget(
  clickedId: number,
  marked: ReadonlySet<number>,
): MenuTarget {
  if (marked.has(clickedId)) {
    const ids = [...marked];
    return { ids, single: ids.length === 1, targetMarked: true };
  }
  return { ids: [clickedId], single: true, targetMarked: false };
}

/**
 * Clamp a menu's top-left so a `w`×`h` box stays within a `vw`×`vh` viewport,
 * keeping at least `margin` px from each edge. Off the right/bottom it flips
 * back in; never positions past the top/left margin.
 */
export function clampMenuPosition(
  x: number,
  y: number,
  w: number,
  h: number,
  vw: number,
  vh: number,
  margin = 4,
): { x: number; y: number } {
  return {
    x: Math.max(margin, Math.min(x, vw - w - margin)),
    y: Math.max(margin, Math.min(y, vh - h - margin)),
  };
}
