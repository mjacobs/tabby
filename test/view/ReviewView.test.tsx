// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';

import type { ReviewState } from '@/shared/messages';
import type { TabInfo } from '@/shared/types';
import { ReviewView } from '@/view/ReviewView';
import type { ReviewTransport } from '@/view/transport';
import { tab } from '../helpers';

afterEach(cleanup);

function makeTransport(tabs: TabInfo[]) {
  const calls = { commitClose: [] as number[][], jumpTo: [] as number[], undo: 0 };
  // Mutable so a test can swap in a fresh stash and fire onReviewUpdated.
  const review: ReviewState = {
    reviewTabs: tabs,
    closedCount: 2,
    emptyWindowIds: [],
    stayingPinnedTabIds: [],
    confirmBeforeCommit: false,
    generatedAt: 0,
  };
  const reviewUpdatedCbs: Array<() => void> = [];
  const transport: ReviewTransport = {
    getReview: async () => review,
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
    onTabRemoved: () => () => {},
    onTabUpdated: () => () => {},
    onReviewUpdated: (cb) => {
      reviewUpdatedCbs.push(cb);
      return () => {
        const i = reviewUpdatedCbs.indexOf(cb);
        if (i >= 0) reviewUpdatedCbs.splice(i, 1);
      };
    },
  };
  // Test hook: mutate the stash, then notify the view as the worker would.
  function restash(next: TabInfo[]) {
    review.reviewTabs = next;
    for (const cb of reviewUpdatedCbs) cb();
  }
  return { transport, calls, restash };
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
