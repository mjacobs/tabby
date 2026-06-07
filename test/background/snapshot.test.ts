import { describe, expect, it } from 'vitest';

import { tabInfoFromChromeTab } from '@/background/snapshot';

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
