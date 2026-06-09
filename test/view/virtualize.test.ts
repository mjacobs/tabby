import { describe, expect, it } from 'vitest';

import { computeWindow, scrollToShow } from '@/view/virtualize';

describe('computeWindow', () => {
  it('returns an empty window for an empty list', () => {
    expect(computeWindow(0, 0, 600, 28, 8)).toEqual({
      start: 0,
      end: 0,
      padTop: 0,
      padBottom: 0,
    });
  });

  it('returns an empty window when rowHeight is non-positive', () => {
    expect(computeWindow(100, 0, 600, 0, 8)).toEqual({
      start: 0,
      end: 0,
      padTop: 0,
      padBottom: 0,
    });
  });

  it('clamps overscan at the top (start never goes below 0)', () => {
    const win = computeWindow(1000, 0, 280, 28, 8);
    expect(win.start).toBe(0);
    expect(win.padTop).toBe(0);
    // 280 / 28 = 10 visible rows, +8 overscan, exclusive end accounts +1.
    expect(win.end).toBeLessThanOrEqual(1000);
    expect(win.end).toBeGreaterThanOrEqual(10);
  });

  it('windows around the scroll position with overscan both sides', () => {
    // Scroll 100 rows down: scrollTop = 2800, viewport 280px (10 rows).
    const win = computeWindow(1000, 2800, 280, 28, 8);
    // firstVisible = 100, minus 8 overscan => 92.
    expect(win.start).toBe(92);
    // lastVisible = ceil((2800+280)/28) = 110, plus 8 overscan => 118.
    expect(win.end).toBe(118);
    expect(win.padTop).toBe(92 * 28);
    expect(win.padBottom).toBe((1000 - 118) * 28);
  });

  it('clamps overscan at the bottom (end never exceeds itemCount)', () => {
    // Scrolled to the very bottom of a 50-item list.
    const total = 50;
    const win = computeWindow(total, total * 28, 280, 28, 8);
    expect(win.end).toBe(total);
    expect(win.padBottom).toBe(0);
    expect(win.start).toBeGreaterThan(0);
    expect(win.padTop).toBe(win.start * 28);
  });

  it('renders only a bounded subset for a huge list', () => {
    const win = computeWindow(5000, 14_000, 280, 28, 8);
    expect(win.end - win.start).toBeLessThan(40);
  });

  it('padTop + rendered height + padBottom equals total content height', () => {
    const total = 1000;
    const rowH = 28;
    const win = computeWindow(total, 2800, 280, rowH, 8);
    const rendered = (win.end - win.start) * rowH;
    expect(win.padTop + rendered + win.padBottom).toBe(total * rowH);
  });

  it('treats a negative scrollTop as 0', () => {
    expect(computeWindow(100, -50, 280, 28, 8)).toEqual(
      computeWindow(100, 0, 280, 28, 8),
    );
  });
});

describe('scrollToShow', () => {
  const rowH = 28;
  const viewport = 280; // 10 rows

  it('returns null when the item is already fully visible', () => {
    // scrollTop 0 shows rows 0..9; row 5 is visible.
    expect(scrollToShow(5, 0, viewport, rowH)).toBeNull();
  });

  it('scrolls up when the item is above the viewport', () => {
    // Viewport at row 50; ask to show row 10.
    expect(scrollToShow(10, 50 * rowH, viewport, rowH)).toBe(10 * rowH);
  });

  it('scrolls down so the item sits at the bottom edge', () => {
    // Viewport at top; ask to show row 20 (below the fold).
    const bottom = (20 + 1) * rowH;
    expect(scrollToShow(20, 0, viewport, rowH)).toBe(bottom - viewport);
  });

  it('returns null for a non-positive rowHeight', () => {
    expect(scrollToShow(5, 0, viewport, 0)).toBeNull();
  });
});
