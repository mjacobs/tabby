import { describe, expect, it } from 'vitest';

import { rowsInBand, autoScrollStep } from '@/view/marquee';
import type { RenderItem } from '@/view/renderItems';
import { tab } from '../helpers';

const H = 28;

// items: row0(id1), row1(id2), header, row3(id3), row4(id4)
const items: RenderItem[] = [
  { kind: 'row', tab: tab({ id: 1 }), index: 0 },
  { kind: 'row', tab: tab({ id: 2 }), index: 1 },
  { kind: 'header', groupId: 7 },
  { kind: 'row', tab: tab({ id: 3 }), index: 2 },
  { kind: 'row', tab: tab({ id: 4 }), index: 3 },
];

describe('rowsInBand', () => {
  it('returns rows whose span intersects the band; skips headers', () => {
    // Band 10..70 covers content rows at 0-28, 28-56, 56-84 → item indices
    // 0,1,2. Item index 2 is the header (skipped); the band's bottom (70) does
    // not reach the row at item index 3 (84-112). So ids 1 and 2.
    expect(rowsInBand(items, H, 10, 70)).toEqual([1, 2]);
  });

  it('is direction-agnostic (drag upward)', () => {
    expect(rowsInBand(items, H, 70, 10)).toEqual([1, 2]);
  });

  it('includes a row only when it actually overlaps (no zero-width touch)', () => {
    // Band exactly 0..28 overlaps only the first row.
    expect(rowsInBand(items, H, 0, 28)).toEqual([1]);
  });

  it('includes rows far down the list (beyond a viewport), enabling auto-scroll', () => {
    // Content y 84..140 spans item index 3 (84-112, id 3) and index 4
    // (112-140, id 4).
    expect(rowsInBand(items, H, 84, 140)).toEqual([3, 4]);
  });

  it('returns empty when the band covers no row', () => {
    expect(rowsInBand([{ kind: 'header', groupId: 7 }], H, 0, 28)).toEqual([]);
  });
});

describe('autoScrollStep', () => {
  it('scrolls up (negative) inside the top edge zone', () => {
    expect(autoScrollStep(5, 600, 40)).toBeLessThan(0);
  });
  it('scrolls down (positive) inside the bottom edge zone', () => {
    expect(autoScrollStep(595, 600, 40)).toBeGreaterThan(0);
  });
  it('does not scroll in the middle', () => {
    expect(autoScrollStep(300, 600, 40)).toBe(0);
  });
  it('scrolls faster nearer the edge', () => {
    expect(Math.abs(autoScrollStep(1, 600, 40))).toBeGreaterThan(
      Math.abs(autoScrollStep(35, 600, 40)),
    );
  });
  it('no-ops on a zero-height viewport (jsdom guard)', () => {
    expect(autoScrollStep(0, 0, 40)).toBe(0);
  });
});
