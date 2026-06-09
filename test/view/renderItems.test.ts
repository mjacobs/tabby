import { describe, expect, it } from 'vitest';

import { renderItems } from '@/view/renderItems';
import { initialState, visibleTabs, type ReviewUiState } from '@/view/state';
import type { TabInfo } from '@/shared/types';
import { tab } from '../helpers';

/** Build a state from tabs plus optional filter / collapsed overrides. */
function stateOf(
  tabs: TabInfo[],
  overrides: Partial<Pick<ReviewUiState, 'filter' | 'collapsed'>> = {},
): ReviewUiState {
  return { ...initialState(tabs), ...overrides };
}

describe('renderItems', () => {
  it('emits one row item per tab with its visible index', () => {
    const state = stateOf([tab({ id: 1 }), tab({ id: 2 }), tab({ id: 3 })]);
    const items = renderItems(state, visibleTabs(state));
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.kind)).toEqual(['row', 'row', 'row']);
    expect(items.map((i) => (i.kind === 'row' ? i.index : -1))).toEqual([
      0, 1, 2,
    ]);
  });

  it('inserts a header when a new group begins', () => {
    const state = stateOf([
      tab({ id: 1 }),
      tab({ id: 2, groupId: 7 }),
      tab({ id: 3, groupId: 7 }),
      tab({ id: 4 }),
    ]);
    const items = renderItems(state, visibleTabs(state));
    expect(items.map((i) => i.kind)).toEqual([
      'row', // ungrouped tab 1
      'header', // group 7 starts
      'row', // tab 2
      'row', // tab 3 (same group, no new header)
      'row', // tab 4
    ]);
  });

  it('keeps row index aligned with visibleTabs across headers', () => {
    const state = stateOf([
      tab({ id: 1, groupId: 5 }),
      tab({ id: 2, groupId: 5 }),
      tab({ id: 3, groupId: 9 }),
    ]);
    const items = renderItems(state, visibleTabs(state));
    const rows = items.filter((i) => i.kind === 'row');
    expect(rows.map((r) => (r.kind === 'row' ? r.index : -1))).toEqual([
      0, 1, 2,
    ]);
    // Two distinct groups => two headers.
    expect(items.filter((i) => i.kind === 'header')).toHaveLength(2);
  });

  it('keeps a collapsed group header but hides its member rows', () => {
    const state = stateOf(
      [tab({ id: 1, groupId: 7 }), tab({ id: 2, groupId: 7 }), tab({ id: 3 })],
      { collapsed: new Set([7]) },
    );
    const items = renderItems(state, visibleTabs(state));
    // The group's header stays; its two members are hidden; the loose row stays.
    expect(items.map((i) => i.kind)).toEqual(['header', 'row']);
    const header = items[0];
    expect(header.kind === 'header' && header.groupId).toBe(7);
    // The surviving row indexes visibleTabs (only the ungrouped tab is visible).
    const row = items[1];
    expect(row.kind === 'row' && row.index).toBe(0);
    expect(row.kind === 'row' && row.tab.id).toBe(3);
  });

  it('drops a collapsed group header when nothing in it matches the filter', () => {
    const state = stateOf(
      [
        tab({ id: 1, groupId: 7, title: 'Alpha' }),
        tab({ id: 2, groupId: 7, title: 'Beta' }),
        tab({ id: 3, title: 'Gamma' }),
      ],
      { collapsed: new Set([7]), filter: 'Gamma' },
    );
    const items = renderItems(state, visibleTabs(state));
    expect(items.map((i) => i.kind)).toEqual(['row']);
    const row = items[0];
    expect(row.kind === 'row' && row.tab.id).toBe(3);
  });

  it('returns an empty list for no tabs', () => {
    const state = stateOf([]);
    expect(renderItems(state, visibleTabs(state))).toEqual([]);
  });
});
