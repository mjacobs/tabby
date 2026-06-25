import { describe, expect, it } from 'vitest';

import { clampMenuPosition, menuTarget } from '@/view/menu';

describe('menuTarget', () => {
  it('targets the whole marked set when the clicked row is marked', () => {
    const t = menuTarget(2, new Set([2, 4, 6]));
    expect(t.ids.slice().sort((a, b) => a - b)).toEqual([2, 4, 6]);
    expect(t.single).toBe(false);
    expect(t.targetMarked).toBe(true);
  });

  it('is single when the clicked row is the only marked one', () => {
    const t = menuTarget(5, new Set([5]));
    expect(t.ids).toEqual([5]);
    expect(t.single).toBe(true);
    expect(t.targetMarked).toBe(true);
  });

  it('targets just the clicked row when it is not marked (ignores other marks)', () => {
    const t = menuTarget(3, new Set([1, 2]));
    expect(t.ids).toEqual([3]);
    expect(t.single).toBe(true);
    expect(t.targetMarked).toBe(false);
  });

  it('targets just the clicked row when nothing is marked', () => {
    const t = menuTarget(9, new Set());
    expect(t.ids).toEqual([9]);
    expect(t.single).toBe(true);
    expect(t.targetMarked).toBe(false);
  });
});

describe('clampMenuPosition', () => {
  it('leaves an in-bounds point untouched', () => {
    expect(clampMenuPosition(100, 100, 160, 120, 1000, 800)).toEqual({
      x: 100,
      y: 100,
    });
  });

  it('flips off the right edge so the menu stays on screen', () => {
    // x=950 + width 160 = 1110 > 1000 → clamp to 1000 - 160 - margin.
    const { x } = clampMenuPosition(950, 100, 160, 120, 1000, 800, 4);
    expect(x).toBe(1000 - 160 - 4);
  });

  it('flips off the bottom edge', () => {
    const { y } = clampMenuPosition(100, 790, 160, 120, 1000, 800, 4);
    expect(y).toBe(800 - 120 - 4);
  });

  it('never positions left/above the margin', () => {
    expect(clampMenuPosition(-50, -50, 160, 120, 1000, 800, 4)).toEqual({
      x: 4,
      y: 4,
    });
  });
});
