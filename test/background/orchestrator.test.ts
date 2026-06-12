import { afterEach, describe, expect, it, vi } from 'vitest';

import { stillOpenWindowIds, openReviewPage } from '@/background/orchestrator';

afterEach(() => vi.unstubAllGlobals());

describe('stillOpenWindowIds', () => {
  it('drops windows Chrome already auto-closed (kata 0awf)', async () => {
    // Window 2 was emptied by consolidation and auto-closed; get() rejects.
    vi.stubGlobal('chrome', {
      windows: {
        get: vi.fn((id: number) =>
          id === 2
            ? Promise.reject(new Error('No window with id: 2'))
            : Promise.resolve({ id }),
        ),
      },
    });
    expect(await stillOpenWindowIds([1, 2, 3])).toEqual([1, 3]);
  });

  it('returns an empty list unchanged without touching chrome', async () => {
    const get = vi.fn();
    vi.stubGlobal('chrome', { windows: { get } });
    expect(await stillOpenWindowIds([])).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });
});

describe('openReviewPage', () => {
  it('creates a new tab when no existing review page starts with the review URL (vp5b)', async () => {
    const getURL = vi.fn(() => 'chrome-extension://abc/src/review/review.html');
    const query = vi.fn(() =>
      Promise.resolve([
        { id: 1, url: 'https://ex.com', windowId: 10 },
        { id: 2, url: 'chrome-extension://abc/options/options.html', windowId: 10 },
      ]),
    );
    const create = vi.fn();
    const updateTab = vi.fn();
    const updateWindow = vi.fn();

    vi.stubGlobal('chrome', {
      runtime: { getURL },
      tabs: { query, create, update: updateTab },
      windows: { update: updateWindow },
    });

    await openReviewPage();

    expect(getURL).toHaveBeenCalledWith('src/review/review.html');
    expect(query).toHaveBeenCalledWith({});
    expect(create).toHaveBeenCalledWith({ url: 'chrome-extension://abc/src/review/review.html' });
    expect(updateTab).not.toHaveBeenCalled();
    expect(updateWindow).not.toHaveBeenCalled();
  });

  it('reuses an existing review tab whose URL merely starts with reviewUrl() (e.g. trailing #hash) and focuses window/tab (vp5b)', async () => {
    const getURL = vi.fn(() => 'chrome-extension://abc/src/review/review.html');
    const query = vi.fn(() =>
      Promise.resolve([
        { id: 1, url: 'https://ex.com', windowId: 10 },
        { id: 2, url: 'chrome-extension://abc/src/review/review.html#some-hash', windowId: 10 },
      ]),
    );
    const create = vi.fn();
    const updateTab = vi.fn();
    const updateWindow = vi.fn();

    vi.stubGlobal('chrome', {
      runtime: { getURL },
      tabs: { query, create, update: updateTab },
      windows: { update: updateWindow },
    });

    await openReviewPage();

    expect(getURL).toHaveBeenCalledWith('src/review/review.html');
    expect(query).toHaveBeenCalledWith({});
    expect(create).not.toHaveBeenCalled();
    expect(updateTab).toHaveBeenCalledWith(2, { active: true });
    expect(updateWindow).toHaveBeenCalledWith(10, { focused: true });
  });
});

