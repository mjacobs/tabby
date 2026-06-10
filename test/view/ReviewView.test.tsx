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
) {
  const calls = { commitClose: [] as number[][], jumpTo: [] as number[], undo: 0 };
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
    jumpTo: async (id) => {
      calls.jumpTo.push(id);
    },
    commitClose: async (ids) => {
      calls.commitClose.push(ids);
      return ids.length;
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
    const { transport } = makeTransport([
      tab({ id: 1, url: 'https://a.com', title: 'Alpha', groupId: 7 }),
      tab({ id: 2, url: 'https://b.com', title: 'Beta', groupId: 7 }),
      tab({ id: 3, url: 'https://c.com', title: 'Gamma' }),
    ]);
    render(<ReviewView transport={transport} />);
    await screen.findByText('Alpha');

    press('x'); // mark Alpha (cursor on the first row)
    await screen.findByText('Close 1');

    press('z'); // collapse group 7 (cursor's group)

    // Member rows vanish; the ungrouped row stays.
    await waitFor(() => expect(screen.queryByText('Alpha')).toBeNull());
    expect(screen.queryByText('Beta')).toBeNull();
    expect(screen.getByText('Gamma')).toBeTruthy();

    // The header survives and its totals are unchanged (2 tabs / 1 to close).
    expect(screen.getByText(/2 tabs · 1 to close/)).toBeTruthy();
    // The mark on a hidden row is preserved (commit button still shows it).
    expect(screen.getByText('Close 1')).toBeTruthy();

    // Expanding (via the header — the cursor is no longer on a member) brings
    // the members and the surviving mark back.
    screen.getByText(/group 7/).click();
    expect(await screen.findByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
    expect(screen.getByText('Close 1')).toBeTruthy();
  });

  it('clicking a group header toggles collapse', async () => {
    const { transport } = makeTransport([
      tab({ id: 1, url: 'https://a.com', title: 'Alpha', groupId: 7 }),
      tab({ id: 2, url: 'https://b.com', title: 'Beta', groupId: 7 }),
    ]);
    render(<ReviewView transport={transport} />);
    const header = await screen.findByText(/group 7/);

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
    expect(screen.getByText(/group 7/)).toBeTruthy();

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
});
