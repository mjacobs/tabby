import { afterEach, describe, expect, it, vi } from 'vitest';

import { tabInfoFromChromeTab } from '@/shared/tabs';
import { snapshotWindows } from '@/background/snapshot';
import { chromeTransport } from '@/view/transport';

afterEach(() => vi.unstubAllGlobals());

// A chrome.tabs.Tab is structurally large; build the subset we map and cast.
function chromeTab(over: Partial<chrome.tabs.Tab>): chrome.tabs.Tab {
  return {
    id: 1,
    windowId: 1,
    index: 0,
    url: 'https://ex.com',
    title: 'Example',
    pinned: false,
    audible: false,
    active: false,
    groupId: -1,
    ...over,
  } as chrome.tabs.Tab;
}

describe('tabInfoFromChromeTab', () => {
  it('maps the fields Tabby reasons about', () => {
    const info = tabInfoFromChromeTab(
      chromeTab({
        id: 7,
        windowId: 3,
        index: 2,
        url: 'https://ex.com/p',
        title: 'P',
        pinned: true,
        audible: true,
        active: true,
        groupId: 11,
        lastAccessed: 123,
      }),
    );
    expect(info).toEqual({
      id: 7,
      windowId: 3,
      index: 2,
      url: 'https://ex.com/p',
      title: 'P',
      pinned: true,
      audible: true,
      active: true,
      groupId: 11,
      lastAccessed: 123,
    });
  });

  it('falls back to pendingUrl, then empty string', () => {
    expect(tabInfoFromChromeTab(chromeTab({ url: '', pendingUrl: 'https://x' })).url).toBe(
      'https://x',
    );
    expect(tabInfoFromChromeTab(chromeTab({ url: undefined, pendingUrl: undefined })).url).toBe(
      '',
    );
  });

  it('defaults audible when chrome omits it', () => {
    expect(tabInfoFromChromeTab(chromeTab({ audible: undefined })).audible).toBe(false);
  });
});

describe('snapshotWindows', () => {
  it('excludes any tab whose URL starts with chrome-extension://<runtime.id>/ while keeping tabs with no URL (vp5b)', async () => {
    const runtimeId = 'extension-id-123';
    vi.stubGlobal('chrome', {
      runtime: {
        id: runtimeId,
      },
      windows: {
        getAll: vi.fn(() =>
          Promise.resolve([
            {
              id: 1,
              focused: true,
              tabs: [
                { id: 10, url: 'https://google.com', index: 0 },
                { id: 11, url: '', pendingUrl: 'https://ex.com', index: 1 },
                { id: 12, url: `chrome-extension://${runtimeId}/review/review.html`, index: 2 },
                { id: 13, url: `chrome-extension://${runtimeId}/options/options.html?foo=bar`, index: 3 },
                { id: 14, url: undefined, index: 4 }, // tab with no URL at all
              ],
            },
          ]),
        ),
      },
    });

    const snapshot = await snapshotWindows();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].id).toBe(1);
    const tabs = snapshot[0].tabs;
    expect(tabs).toHaveLength(3);
    expect(tabs.map((t) => t.id)).toEqual([10, 11, 14]);
  });
});

describe('chromeTransport.queryTabs', () => {
  it('excludes any tab whose URL starts with chrome-extension://<runtime.id>/ while keeping tabs with no URL (vp5b)', async () => {
    const runtimeId = 'extension-id-123';
    vi.stubGlobal('chrome', {
      runtime: {
        id: runtimeId,
      },
      tabs: {
        query: vi.fn(({ windowId }) =>
          Promise.resolve([
            { id: 10, url: 'https://google.com', windowId, index: 0 },
            { id: 11, url: '', pendingUrl: 'https://ex.com', windowId, index: 1 },
            { id: 12, url: `chrome-extension://${runtimeId}/review/review.html`, windowId, index: 2 },
            { id: 13, url: `chrome-extension://${runtimeId}/options/options.html?foo=bar`, windowId, index: 3 },
            { id: 14, url: undefined, windowId, index: 4 }, // tab with no URL at all
          ]),
        ),
      },
    });

    const tabs = await chromeTransport.queryTabs(1);
    expect(tabs).toHaveLength(3);
    expect(tabs.map((t) => t.id)).toEqual([10, 11, 14]);
  });
});

