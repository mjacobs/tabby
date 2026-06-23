// Pure geometry for the drag-marquee selection. No DOM: works in the same
// content-coordinate model the virtualizer uses (item index × rowHeight), so it
// naturally handles off-screen rows (edge auto-scroll) and skips group headers.

import type { RenderItem } from '@/view/renderItems';

/**
 * Tab ids of the `row` items whose vertical span [i*rowHeight, (i+1)*rowHeight)
 * intersects the band between `bandA` and `bandB` (either order). Header items
 * are skipped — only rows can be marked.
 */
export function rowsInBand(
  items: RenderItem[],
  rowHeight: number,
  bandA: number,
  bandB: number,
): number[] {
  const lo = Math.min(bandA, bandB);
  const hi = Math.max(bandA, bandB);
  const ids: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== 'row') continue;
    const top = i * rowHeight;
    const bottom = top + rowHeight;
    // Half-open overlap: a band that only touches a row's bottom edge (hi===top)
    // doesn't select it, matching the "covers the row" intuition.
    if (bottom > lo && top < hi) ids.push(item.tab.id);
  }
  return ids;
}

/**
 * Auto-scroll velocity (px/frame) when a drag holds the pointer near a viewport
 * edge: negative inside `edge` px of the top, positive inside `edge` px of the
 * bottom, scaled by how deep into the zone the pointer is, else 0.
 */
export function autoScrollStep(
  pointerY: number,
  viewportHeight: number,
  edge: number,
  maxStep = 16,
): number {
  if (edge <= 0 || viewportHeight <= 0) return 0;
  if (pointerY < edge) {
    const intensity = Math.min(1, (edge - pointerY) / edge);
    return -Math.ceil(intensity * maxStep);
  }
  if (pointerY > viewportHeight - edge) {
    const intensity = Math.min(1, (pointerY - (viewportHeight - edge)) / edge);
    return Math.ceil(intensity * maxStep);
  }
  return 0;
}
