import { describe, expect, it } from 'vitest';

import {
  currentTab,
  initialState,
  reduce,
  visibleTabs,
  type ReviewUiState,
} from '@/view/state';
import { tab } from '../helpers';

function load(...urls: string[]): ReviewUiState {
  return initialState(urls.map((url, i) => tab({ id: i + 1, url, title: url })));
}

describe('review state', () => {
  it('moves the cursor and clamps at bounds', () => {
    let s = load('a', 'b', 'c');
    s = reduce(s, { type: 'move', delta: 1 });
    expect(s.cursor).toBe(1);
    s = reduce(s, { type: 'move', delta: 10 });
    expect(s.cursor).toBe(2); // clamped
    s = reduce(s, { type: 'move', delta: -10 });
    expect(s.cursor).toBe(0);
  });

  it('jumps to top and bottom', () => {
    let s = load('a', 'b', 'c');
    s = reduce(s, { type: 'moveTo', to: 'bottom' });
    expect(s.cursor).toBe(2);
    s = reduce(s, { type: 'moveTo', to: 'top' });
    expect(s.cursor).toBe(0);
  });

  it('toggles a mark on the current row', () => {
    let s = load('a', 'b', 'c');
    s = reduce(s, { type: 'move', delta: 1 });
    s = reduce(s, { type: 'toggleMark' });
    expect([...s.marked]).toEqual([2]);
    s = reduce(s, { type: 'toggleMark' });
    expect([...s.marked]).toEqual([]);
  });

  it('marks a visual range', () => {
    let s = load('a', 'b', 'c', 'd');
    s = reduce(s, { type: 'move', delta: 1 }); // cursor at 1
    s = reduce(s, { type: 'startVisual' }); // anchor 1
    s = reduce(s, { type: 'move', delta: 2 }); // cursor 3
    s = reduce(s, { type: 'toggleMark' }); // applies range 1..3
    expect([...s.marked].sort()).toEqual([2, 3, 4]);
    expect(s.visualAnchor).toBeNull();
  });

  it('filters by title/url and clamps the cursor', () => {
    let s = initialState([
      tab({ id: 1, url: 'https://a.com', title: 'apple' }),
      tab({ id: 2, url: 'https://b.com', title: 'banana' }),
      tab({ id: 3, url: 'https://c.com', title: 'avocado' }),
    ]);
    s = reduce(s, { type: 'moveTo', to: 'bottom' }); // cursor 2
    s = reduce(s, { type: 'setFilter', query: 'a' });
    // 'apple' and 'avocado' match (banana also has an 'a'!) — so check 'av'
    s = reduce(s, { type: 'setFilter', query: 'avoc' });
    expect(visibleTabs(s).map((t) => t.id)).toEqual([3]);
    expect(s.cursor).toBe(0); // clamped from 2
    expect(currentTab(s)?.id).toBe(3);
  });

  it('removes tabs and unmarks them', () => {
    let s = load('a', 'b', 'c');
    s = reduce(s, { type: 'toggleMark' }); // mark id 1
    s = reduce(s, { type: 'removeTabs', ids: [1] });
    expect(s.tabs.map((t) => t.id)).toEqual([2, 3]);
    expect(s.marked.size).toBe(0);
  });

  it('markAll marks every visible tab; clearMarks empties', () => {
    let s = load('a', 'b', 'c');
    s = reduce(s, { type: 'markAll' });
    expect(s.marked.size).toBe(3);
    s = reduce(s, { type: 'clearMarks' });
    expect(s.marked.size).toBe(0);
  });

  it('collapsing a group hides its members but keeps marks and totals', () => {
    let s = initialState([
      tab({ id: 1, url: 'a', title: 'a', groupId: 7 }),
      tab({ id: 2, url: 'b', title: 'b', groupId: 7 }),
      tab({ id: 3, url: 'c', title: 'c' }),
    ]);
    // mark a member of the group, then collapse from a member row.
    s = reduce(s, { type: 'toggleMark' }); // mark id 1 (cursor at 0)
    s = reduce(s, { type: 'toggleCollapse' }); // current row's group = 7
    expect(visibleTabs(s).map((t) => t.id)).toEqual([3]); // members hidden
    expect([...s.marked]).toEqual([1]); // mark on hidden row survives
    expect(s.tabs.length).toBe(3); // totals unchanged
    // expand restores the rows; mark still present.
    s = reduce(s, { type: 'toggleCollapse', groupId: 7 });
    expect(visibleTabs(s).map((t) => t.id)).toEqual([1, 2, 3]);
    expect([...s.marked]).toEqual([1]);
  });

  it('j/k skip a collapsed group and land on the next visible row', () => {
    let s = initialState([
      tab({ id: 1, url: 'a', title: 'a', groupId: 7 }),
      tab({ id: 2, url: 'b', title: 'b', groupId: 7 }),
      tab({ id: 3, url: 'c', title: 'c' }),
    ]);
    s = reduce(s, { type: 'toggleCollapse', groupId: 7 }); // collapse first
    // Only the ungrouped tab is visible; the cursor cannot land on members.
    expect(visibleTabs(s).map((t) => t.id)).toEqual([3]);
    s = reduce(s, { type: 'moveTo', to: 'top' });
    expect(currentTab(s)?.id).toBe(3);
    s = reduce(s, { type: 'move', delta: -1 }); // clamped, still on 3
    expect(currentTab(s)?.id).toBe(3);
  });

  it('toggleCollapse clamps the cursor onto a still-visible row', () => {
    let s = initialState([
      tab({ id: 1, url: 'a', title: 'a' }),
      tab({ id: 2, url: 'b', title: 'b', groupId: 7 }),
      tab({ id: 3, url: 'c', title: 'c', groupId: 7 }),
    ]);
    s = reduce(s, { type: 'moveTo', to: 'bottom' }); // cursor on id 3
    s = reduce(s, { type: 'toggleCollapse' }); // collapse group 7
    // id 3 is gone from the visible list; cursor must clamp to the last visible.
    expect(currentTab(s)?.id).toBe(1);
  });

  it('escape clears visual anchor and help', () => {
    let s = load('a', 'b');
    s = reduce(s, { type: 'startVisual' });
    s = reduce(s, { type: 'toggleHelp' });
    s = reduce(s, { type: 'escape' });
    expect(s.visualAnchor).toBeNull();
    expect(s.showHelp).toBe(false);
  });
});
