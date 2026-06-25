// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';

import type { ReviewState } from '@/shared/messages';
import type { RecommendReason } from '@/core/recommend';
import { DEFAULT_SETTINGS } from '@/shared/settings';
import type { TabInfo } from '@/shared/types';
import { ReviewView } from '@/view/ReviewView';
import type { ReviewTransport } from '@/view/transport';
import { tab } from '../helpers';

afterEach(cleanup);

function makeTransport(
  tabs: TabInfo[],
  recommendations: Array<{ tabId: number; reasons: RecommendReason[] }> = [],
  groupTitles: Record<number, string> = {},
) {
  const calls = {
    commitClose: [] as number[][],
    stashClose: [] as number[][],
    jumpTo: [] as number[],
    undo: 0,
  };
  // Mutable so a test can swap in a fresh stash and fire onReviewUpdated.
  const review: ReviewState = {
    reviewTabs: tabs,
    targetWindowId: 1,
    closedCount: 2,
    emptyWindowIds: [],
    stayingPinnedTabIds: [],
    confirmBeforeCommit: false,
    generatedAt: 0,
  };
  let liveTabs = tabs; // what queryTabs returns; the review mirrors this.
  const reviewUpdatedCbs: Array<() => void> = [];
  const tabsChangedCbs: Array<() => void> = [];
  const transport: ReviewTransport = {
    getReview: async () => review,
    getSettings: async () => DEFAULT_SETTINGS,
    queryTabs: async () => liveTabs,
    queryGroups: async () => {
      const ids = [
        ...new Set(
          liveTabs
            .filter((t) => t.groupId != null && t.groupId !== -1)
            .map((t) => t.groupId as number),
        ),
      ];
      return ids.map((id) => ({ id, title: groupTitles[id] ?? '' }));
    },
    jumpTo: async (id) => {
      calls.jumpTo.push(id);
    },
    commitClose: async (ids) => {
      calls.commitClose.push(ids);
      return ids.length;
    },
    stashClose: async (ids) => {
      calls.stashClose.push(ids);
      return { stashed: ids.length, closed: ids.length };
    },
    undo: async () => {
      calls.undo++;
      return 1;
    },
    closeEmptyWindows: async () => 0,
    getRecommendations: async (forTabs) =>
      recommendations.filter((r) => forTabs.some((t) => t.id === r.tabId)),
    onTabsChanged: (cb) => {
      tabsChangedCbs.push(cb);
      return () => {
        const i = tabsChangedCbs.indexOf(cb);
        if (i >= 0) tabsChangedCbs.splice(i, 1);
      };
    },
    onReviewUpdated: (cb) => {
      reviewUpdatedCbs.push(cb);
      return () => {
        const i = reviewUpdatedCbs.indexOf(cb);
        if (i >= 0) reviewUpdatedCbs.splice(i, 1);
      };
    },
  };
  // Test hook: change the window's live tabs, then fire a tab-change event.
  function setLiveTabs(next: TabInfo[]) {
    liveTabs = next;
    for (const cb of tabsChangedCbs) cb();
  }
  // Test hook: a fresh run re-stashes and notifies open pages.
  function restash(next: TabInfo[]) {
    review.reviewTabs = next;
    liveTabs = next;
    for (const cb of reviewUpdatedCbs) cb();
  }
  return { transport, calls, setLiveTabs, restash };
}

function press(key: string, opts: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, ...opts }));
}

function mouse(type: string, target: Element | Window, clientY: number) {
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY }),
  );
}

function contextMenu(target: Element, clientX = 0, clientY = 0) {
  const e = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
  });
  target.dispatchEvent(e);
  return e;
}

describe('ReviewView', () => {
  it('renders the loaded tabs with a count summary', async () => {
    const { transport } = makeTransport([
      tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
      tab({ id: 2, url: 'https://b.com', title: 'Beta' }),
    ]);
    render(<ReviewView transport={transport} />);

    expect(await screen.findByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
  });

  it('marks the cursor row and commits the close', async () => {
    const { transport, calls } = makeTransport([
      tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
      tab({ id: 2, url: 'https://b.com', title: 'Beta' }),
    ]);
    render(<ReviewView transport={transport} />);
    await screen.findByText('Alpha');

    press('x'); // mark row under cursor (id 1)
    await screen.findByText('Close 1'); // commit button reflects the mark

    press('Enter', { metaKey: true }); // commit
    await waitFor(() => expect(calls.commitClose).toEqual([[1]]));
    // The committed row is removed from the list.
    await waitFor(() => expect(screen.queryByText('Alpha')).toBeNull());
    expect(screen.getByText('Beta')).toBeTruthy();
  });

  it('stashes the marked tabs on shift+S and removes them from the list', async () => {
    const { transport, calls } = makeTransport([
      tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
      tab({ id: 2, url: 'https://b.com', title: 'Beta' }),
    ]);
    render(<ReviewView transport={transport} />);
    await screen.findByText('Alpha');

    press('x'); // mark row under cursor (id 1)
    await screen.findByText('Close 1');

    press('S'); // shift+S: stash marked
    await waitFor(() => expect(calls.stashClose).toEqual([[1]]));
    // Stash closes too, so the stashed row leaves the list; nothing was sent
    // through the plain close path.
    await waitFor(() => expect(screen.queryByText('Alpha')).toBeNull());
    expect(screen.getByText('Beta')).toBeTruthy();
    expect(calls.commitClose).toEqual([]);
  });

  it('moves the cursor and marks the second row', async () => {
    const { transport, calls } = makeTransport([
      tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
      tab({ id: 2, url: 'https://b.com', title: 'Beta' }),
    ]);
    render(<ReviewView transport={transport} />);
    await screen.findByText('Alpha');

    press('j'); // cursor → row 2
    press('x'); // mark id 2
    await screen.findByText('Close 1');

    press('Enter', { ctrlKey: true });
    await waitFor(() => expect(calls.commitClose).toEqual([[2]]));
  });

  it('reconciles to a fresh stash when the worker broadcasts reviewUpdated', async () => {
    const { transport, restash } = makeTransport([
      tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
    ]);
    render(<ReviewView transport={transport} />);
    await screen.findByText('Alpha');

    // A new run re-stashes with extra tabs and notifies the open page.
    restash([
      tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
      tab({ id: 2, url: 'https://b.com', title: 'Beta' }),
      tab({ id: 3, url: 'https://c.com', title: 'Gamma' }),
    ]);

    // The previously-stale list now shows the tabs opened after the snapshot.
    expect(await screen.findByText('Beta')).toBeTruthy();
    expect(screen.getByText('Gamma')).toBeTruthy();
  });

  it('shows tabs opened after the snapshot once a tab-change fires (live)', async () => {
    const { transport, setLiveTabs } = makeTransport([
      tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
    ]);
    render(<ReviewView transport={transport} />);
    await screen.findByText('Alpha');

    // A new tab opens in the window after the cleanup ran.
    setLiveTabs([
      tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
      tab({ id: 2, url: 'https://b.com', title: 'Beta' }),
    ]);

    expect(await screen.findByText('Beta')).toBeTruthy();
  });

  it('drops a row when the tab is closed outside the review (live)', async () => {
    const { transport, setLiveTabs } = makeTransport([
      tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
      tab({ id: 2, url: 'https://b.com', title: 'Beta' }),
    ]);
    render(<ReviewView transport={transport} />);
    await screen.findByText('Beta');

    setLiveTabs([tab({ id: 1, url: 'https://a.com', title: 'Alpha' })]);

    await waitFor(() => expect(screen.queryByText('Beta')).toBeNull());
    expect(screen.getByText('Alpha')).toBeTruthy();
  });

  it('preserves marks across a live reconcile for tabs still present', async () => {
    const { transport, setLiveTabs } = makeTransport([
      tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
      tab({ id: 2, url: 'https://b.com', title: 'Beta' }),
    ]);
    render(<ReviewView transport={transport} />);
    await screen.findByText('Alpha');

    press('x'); // mark id 1
    await screen.findByText('Close 1');

    // A third tab opens; the existing mark on id 1 must survive the reconcile.
    setLiveTabs([
      tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
      tab({ id: 2, url: 'https://b.com', title: 'Beta' }),
      tab({ id: 3, url: 'https://c.com', title: 'Gamma' }),
    ]);
    await screen.findByText('Gamma');
    expect(screen.getByText('Close 1')).toBeTruthy(); // still one marked
  });

  it('collapses a group: hides members, keeps the header and its counts', async () => {
    const { transport } = makeTransport(
      [
        tab({ id: 1, url: 'https://a.com', title: 'Alpha', groupId: 7 }),
        tab({ id: 2, url: 'https://b.com', title: 'Beta', groupId: 7 }),
        tab({ id: 3, url: 'https://c.com', title: 'Gamma' }),
      ],
      [],
      { 7: 'Docs' },
    );
    render(<ReviewView transport={transport} />);
    await screen.findByText('Alpha');

    press('x'); // mark Alpha (cursor on the first row)
    await screen.findByText('Close 1');

    press('z'); // collapse group 7 (cursor's group)

    // Member rows vanish; the ungrouped row stays.
    await waitFor(() => expect(screen.queryByText('Alpha')).toBeNull());
    expect(screen.queryByText('Beta')).toBeNull();
    expect(screen.getByText('Gamma')).toBeTruthy();

    // The header survives, shows the group's name, and its totals are unchanged.
    expect(screen.getByText('Docs')).toBeTruthy();
    expect(screen.getByText(/2 tabs · 1 to close/)).toBeTruthy();
    // The mark on a hidden row is preserved (commit button still shows it).
    expect(screen.getByText('Close 1')).toBeTruthy();

    // Expanding (via the header — the cursor is no longer on a member) brings
    // the members and the surviving mark back.
    screen.getByText('Docs').click();
    expect(await screen.findByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
    expect(screen.getByText('Close 1')).toBeTruthy();
  });

  it('clicking a group header toggles collapse', async () => {
    const { transport } = makeTransport(
      [
        tab({ id: 1, url: 'https://a.com', title: 'Alpha', groupId: 7 }),
        tab({ id: 2, url: 'https://b.com', title: 'Beta', groupId: 7 }),
      ],
      [],
      { 7: 'Docs' },
    );
    render(<ReviewView transport={transport} />);
    const header = await screen.findByText('Docs');

    header.click();
    await waitFor(() => expect(screen.queryByText('Alpha')).toBeNull());

    header.click();
    expect(await screen.findByText('Alpha')).toBeTruthy();
  });

  it('j/k skip the members of a collapsed group', async () => {
    const { transport, calls } = makeTransport([
      tab({ id: 1, url: 'https://a.com', title: 'Alpha', groupId: 7 }),
      tab({ id: 2, url: 'https://b.com', title: 'Beta', groupId: 7 }),
      tab({ id: 3, url: 'https://c.com', title: 'Gamma' }),
    ]);
    render(<ReviewView transport={transport} />);
    await screen.findByText('Alpha');

    press('z'); // collapse group 7 — only Gamma stays visible
    await waitFor(() => expect(screen.queryByText('Alpha')).toBeNull());

    // Cursor starts at the only visible row (Gamma); Enter jumps to it, never a
    // hidden member.
    press('Enter');
    await waitFor(() => expect(calls.jumpTo).toEqual([3]));

    // j/k cannot land on a hidden member: still Gamma.
    press('j');
    press('Enter');
    await waitFor(() => expect(calls.jumpTo).toEqual([3, 3]));
  });

  it('shows advisory recommendation badges with their reasons (kata 9kb5)', async () => {
    const { transport } = makeTransport(
      [
        tab({ id: 1, url: 'https://a.com/saved', title: 'Saved page' }),
        tab({ id: 2, url: 'https://bank.com/login', title: 'Bank login' }),
        tab({ id: 3, url: 'https://c.com', title: 'Plain tab' }),
      ],
      [
        { tabId: 1, reasons: ['bookmarked'] },
        { tabId: 2, reasons: ['stranded-auth'] },
      ],
    );
    render(<ReviewView transport={transport} />);
    await screen.findByText('Saved page');

    await screen.findByText('bookmarked');
    await screen.findByText('stale login');
    // The unflagged tab gets no suggest badge.
    expect(screen.getAllByText(/bookmarked|stale login/)).toHaveLength(2);
  });

  it('renders only a bounded subset of rows for a large list', async () => {
    // 500 pinned tabs keep a stable order (pinned sort first, by index), so a
    // far-down tab is predictably absent from the initial window.
    const many = Array.from({ length: 500 }, (_, i) =>
      tab({ id: i + 1, index: i, pinned: true, title: `Tab ${i + 1}` }),
    );
    const { transport } = makeTransport(many);
    const { container } = render(<ReviewView transport={transport} />);
    await screen.findByText('Tab 1');

    const rows = container.querySelectorAll('.row');
    // Far fewer than 500 rows are in the DOM (window + overscan only).
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(100);
    // A far-down tab is not rendered yet.
    expect(screen.queryByText('Tab 400')).toBeNull();
  });

  it('scrolls the cursor into the window when it moves past the bottom', async () => {
    const many = Array.from({ length: 500 }, (_, i) =>
      tab({ id: i + 1, index: i, pinned: true, title: `Tab ${i + 1}` }),
    );
    const { transport } = makeTransport(many);
    const { container } = render(<ReviewView transport={transport} />);
    await screen.findByText('Tab 1');
    // The last-in-order tab is well outside the initial window.
    expect(screen.queryByText('Tab 500')).toBeNull();

    press('G'); // jump cursor to the last tab in order

    // The cursor row is scrolled into the rendered window and now in the DOM.
    expect(await screen.findByText('Tab 500')).toBeTruthy();
    // The cursor marker is on the now-visible last row.
    expect(container.querySelector('.row.cursor')).not.toBeNull();
    // The original top rows have left the window.
    expect(screen.queryByText('Tab 1')).toBeNull();
  });

  it('still marks and commits a row that required scrolling into view', async () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      tab({ id: i + 1, index: i, pinned: true, title: `Tab ${i + 1}` }),
    );
    const { transport, calls } = makeTransport(many);
    render(<ReviewView transport={transport} />);
    await screen.findByText('Tab 1');

    press('G'); // cursor → last tab in order (id 300)
    await screen.findByText('Tab 300');
    press('x'); // mark it
    await screen.findByText('Close 1');

    press('Enter', { metaKey: true });
    await waitFor(() => expect(calls.commitClose).toEqual([[300]]));
  });

  it('keeps windowing + cursor mapping correct with a collapsed group in a large list', async () => {
    // A group near the top of a long list. Collapsing it removes its members
    // from visibleTabs (so the cursor space shrinks) while its header stays a
    // rendered row — the virtualization slice and cursor-into-view must still
    // line up. Pinned + index keep a stable order.
    const groupSize = 40;
    const many = Array.from({ length: 500 }, (_, i) =>
      tab({
        id: i + 1,
        index: i,
        pinned: true,
        title: `Tab ${i + 1}`,
        // Tabs 1..40 form group 7; the rest are ungrouped.
        ...(i < groupSize ? { groupId: 7 } : {}),
      }),
    );
    const { transport, calls } = makeTransport(many);
    render(<ReviewView transport={transport} />);
    await screen.findByText('Tab 1');

    // Collapse group 7 (cursor starts on its first member). Members vanish; the
    // header survives.
    press('z');
    await waitFor(() => expect(screen.queryByText('Tab 1')).toBeNull());
    // Untitled group falls back to a generic label (never the numeric id).
    expect(screen.getByText('Group')).toBeTruthy();

    // G jumps the cursor to the last visible tab (id 500) and scrolls it into
    // the window despite the collapsed group above shifting rendered indices.
    press('G');
    expect(await screen.findByText('Tab 500')).toBeTruthy();
    // Marking + committing the scrolled-to row resolves to the right tab id.
    press('x');
    await screen.findByText('Close 1');
    press('Enter', { metaKey: true });
    await waitFor(() => expect(calls.commitClose).toEqual([[500]]));
  });

  it('clicking a suggestion badge marks the tab, never closes it (kata 49m8)', async () => {
    const { transport, calls } = makeTransport(
      [
        tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
        tab({ id: 2, url: 'https://bank.com/login', title: 'Bank login' }),
      ],
      [{ tabId: 2, reasons: ['stranded-auth'] }],
    );
    render(<ReviewView transport={transport} />);
    const badge = await screen.findByText('stale login');

    badge.click();
    // The badged tab is now marked (commit button reflects it)…
    await screen.findByText('Close 1');
    // …but nothing was closed and the click did not jump to the tab.
    expect(calls.commitClose).toEqual([]);
    expect(calls.jumpTo).toEqual([]);
  });

  it('jumps to a tab on Enter without a modifier', async () => {
    const { transport, calls } = makeTransport([
      tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
    ]);
    render(<ReviewView transport={transport} />);
    await screen.findByText('Alpha');

    press('Enter');
    await waitFor(() => expect(calls.jumpTo).toEqual([1]));
  });

  it('clicking the row body toggles the mark and does not jump (kata rxxe)', async () => {
    const { transport, calls } = makeTransport([
      tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
      tab({ id: 2, url: 'https://b.com', title: 'Beta' }),
    ]);
    const { container } = render(<ReviewView transport={transport} />);
    await screen.findByText('Alpha');

    // Click the row <li> body (not a link): toggles the mark, never jumps.
    const row = container.querySelector('.row') as HTMLElement;
    row.click();
    await screen.findByText('Close 1');
    expect(calls.jumpTo).toEqual([]);

    // Clicking again unmarks.
    row.click();
    await waitFor(() => expect(screen.queryByText('Close 1')).toBeNull());
  });

  it('clicking the title text switches to that tab (kata rxxe)', async () => {
    const { transport, calls } = makeTransport([
      tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
    ]);
    render(<ReviewView transport={transport} />);
    const title = await screen.findByText('Alpha');

    title.click();
    await waitFor(() => expect(calls.jumpTo).toEqual([1]));
    // The title click did not also mark the row.
    expect(screen.queryByText('Close 1')).toBeNull();
  });

  it('clicking the host text switches to that tab (kata rxxe)', async () => {
    const { transport, calls } = makeTransport([
      tab({ id: 1, url: 'https://a.com/page', title: 'Alpha' }),
    ]);
    const { container } = render(<ReviewView transport={transport} />);
    await screen.findByText('Alpha');

    (container.querySelector('.row .url') as HTMLElement).click();
    await waitFor(() => expect(calls.jumpTo).toEqual([1]));
  });

  it('drag-marquee additively marks the rows the band covers (kata rxxe)', async () => {
    const { transport, calls } = makeTransport([
      tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
      tab({ id: 2, url: 'https://b.com', title: 'Beta' }),
      tab({ id: 3, url: 'https://c.com', title: 'Gamma' }),
    ]);
    const { container } = render(<ReviewView transport={transport} />);
    await screen.findByText('Alpha');

    const firstRow = container.querySelector('.row') as HTMLElement;

    // Drag from y=2 (row 0) down to y=70 (covers rows at 0-28, 28-56, 56-84 →
    // ids 1,2,3). Past the 5px threshold ⇒ a drag, not a click.
    mouse('mousedown', firstRow, 2);
    mouse('mousemove', window, 70);
    mouse('mouseup', window, 70);

    // All three rows are marked (additive markIds), and nothing jumped.
    await screen.findByText('Close 3');
    expect(calls.jumpTo).toEqual([]);

    // The drag's trailing click on the row is suppressed (does not toggle a row
    // back off): still 3 marked after a click fires on the row.
    firstRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(screen.getByText('Close 3')).toBeTruthy();
  });

  it('clicking the row × closes that one tab, without marking or jumping (rz1c)', async () => {
    const { transport, calls } = makeTransport([
      tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
      tab({ id: 2, url: 'https://b.com', title: 'Beta' }),
    ]);
    const { container } = render(<ReviewView transport={transport} />);
    await screen.findByText('Alpha');

    const closeBtn = container.querySelector('.row .row-close') as HTMLElement;
    closeBtn.click();

    // The tab is closed immediately (commitClose), the row leaves the list, and
    // the click neither toggled a mark nor jumped to the tab.
    await waitFor(() => expect(calls.commitClose).toEqual([[1]]));
    await waitFor(() => expect(screen.queryByText('Alpha')).toBeNull());
    expect(calls.jumpTo).toEqual([]);
    expect(screen.queryByText('Close 1')).toBeNull(); // no leftover mark
    expect(screen.getByText('Beta')).toBeTruthy();
  });

  it('right-click on an unmarked row opens a menu that closes just that tab (rz1c)', async () => {
    const { transport, calls } = makeTransport([
      tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
      tab({ id: 2, url: 'https://b.com', title: 'Beta' }),
    ]);
    const { container } = render(<ReviewView transport={transport} />);
    await screen.findByText('Alpha');

    const firstRow = container.querySelector('.row') as HTMLElement;
    const e = contextMenu(firstRow);
    // Chrome's default page menu is suppressed.
    expect(e.defaultPrevented).toBe(true);

    // The menu targets just this one (unmarked) row.
    (await screen.findByText('Close tab')).click();
    await waitFor(() => expect(calls.commitClose).toEqual([[1]]));
    // Acting dismissed the menu.
    await waitFor(() => expect(screen.queryByText('Close tab')).toBeNull());
    expect(calls.jumpTo).toEqual([]);
  });

  it('right-click on a marked row acts on the whole marked selection (rz1c)', async () => {
    const { transport, calls } = makeTransport([
      tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
      tab({ id: 2, url: 'https://b.com', title: 'Beta' }),
      tab({ id: 3, url: 'https://c.com', title: 'Gamma' }),
    ]);
    const { container } = render(<ReviewView transport={transport} />);
    await screen.findByText('Alpha');

    press('a'); // mark all visible (ids 1,2,3)
    await screen.findByText('Close 3');

    const secondRow = container.querySelectorAll('.row')[1] as HTMLElement;
    contextMenu(secondRow); // right-click a row that is part of the selection
    (await screen.findByText('Close 3 tabs')).click();
    await waitFor(() => expect(calls.commitClose).toEqual([[1, 2, 3]]));
  });

  it('the menu Jump item shows only for a single-row target and jumps (rz1c)', async () => {
    const { transport, calls } = makeTransport([
      tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
      tab({ id: 2, url: 'https://b.com', title: 'Beta' }),
    ]);
    const { container } = render(<ReviewView transport={transport} />);
    await screen.findByText('Alpha');

    const firstRow = container.querySelector('.row') as HTMLElement;
    contextMenu(firstRow); // unmarked single row → Jump present
    (await screen.findByText('Jump to tab')).click();
    await waitFor(() => expect(calls.jumpTo).toEqual([1]));

    press('a'); // mark both
    await screen.findByText('Close 2');
    contextMenu(firstRow); // multi-target → no Jump
    await screen.findByText('Close 2 tabs');
    expect(screen.queryByText('Jump to tab')).toBeNull();
  });

  it('the menu marks an unmarked target and unmarks a marked one (rz1c)', async () => {
    const { transport } = makeTransport([
      tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
      tab({ id: 2, url: 'https://b.com', title: 'Beta' }),
    ]);
    const { container } = render(<ReviewView transport={transport} />);
    await screen.findByText('Alpha');

    const firstRow = container.querySelector('.row') as HTMLElement;
    contextMenu(firstRow); // unmarked → "Mark"
    (await screen.findByText('Mark')).click();
    await screen.findByText('Close 1');

    contextMenu(firstRow); // now marked → "Unmark"
    (await screen.findByText('Unmark')).click();
    await waitFor(() => expect(screen.queryByText('Close 1')).toBeNull());
  });

  it('moves focus into the menu on open and restores it on dismiss (rz1c a11y)', async () => {
    const { transport } = makeTransport([
      tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
      tab({ id: 2, url: 'https://b.com', title: 'Beta' }),
    ]);
    const { container } = render(<ReviewView transport={transport} />);
    await screen.findByText('Alpha');

    // Focus a control in the row before opening, to prove focus is restored.
    const opener = container.querySelector('.row .row-close') as HTMLElement;
    opener.focus();
    expect(document.activeElement).toBe(opener);

    contextMenu(container.querySelector('.row') as HTMLElement);
    // Focus lands on the first menu item so the menu is keyboard-operable.
    const firstItem = await screen.findByText('Close tab');
    expect(document.activeElement).toBe(firstItem);

    // Escape closes and returns focus to where it was.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor(() => expect(screen.queryByText('Close tab')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('a plain click (no drag) still toggles a single row, not a marquee', async () => {
    const { transport } = makeTransport([
      tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
      tab({ id: 2, url: 'https://b.com', title: 'Beta' }),
    ]);
    const { container } = render(<ReviewView transport={transport} />);
    await screen.findByText('Alpha');

    const firstRow = container.querySelector('.row') as HTMLElement;
    // mousedown + mouseup at the same point (no movement) ⇒ a click, which the
    // <li> onClick turns into a single toggle.
    mouse('mousedown', firstRow, 10);
    mouse('mouseup', firstRow, 10);
    firstRow.click();
    await screen.findByText('Close 1');
  });
});
