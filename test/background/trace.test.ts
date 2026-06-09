import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildNavRecord, disableTrace, enableTrace } from '@/background/trace';
import { getRecords } from '@/background/records';
import type { RecordEntry } from '@/shared/messages';

describe('buildNavRecord (pure)', () => {
  it('formats a nav entry from commit details and the prior url', () => {
    const rec = buildNavRecord(
      {
        tabId: 7,
        url: 'https://bank.com/login',
        transitionType: 'reload',
        transitionQualifiers: ['server_redirect'],
      },
      'https://bank.com/dashboard',
      123,
    );
    expect(rec).toEqual({
      at: 123,
      kind: 'nav',
      tabId: 7,
      fromUrl: 'https://bank.com/dashboard',
      toUrl: 'https://bank.com/login',
      transitionType: 'reload',
      qualifiers: ['server_redirect'],
    });
  });
});

// --- listener behavior against a fake chrome global --------------------------

type Listener = (...args: unknown[]) => void;

function fakeChrome(extId = 'tabbyid') {
  const local: Record<string, unknown> = {};
  const navListeners: Listener[] = [];
  const removedListeners: Listener[] = [];
  return {
    runtime: { id: extId },
    webNavigation: {
      onCommitted: {
        addListener: (l: Listener) => navListeners.push(l),
        removeListener: (l: Listener) => {
          const i = navListeners.indexOf(l);
          if (i >= 0) navListeners.splice(i, 1);
        },
      },
    },
    tabs: {
      onRemoved: {
        addListener: (l: Listener) => removedListeners.push(l),
        removeListener: (l: Listener) => {
          const i = removedListeners.indexOf(l);
          if (i >= 0) removedListeners.splice(i, 1);
        },
      },
    },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: local[key] }),
        set: async (obj: Record<string, unknown>) => {
          Object.assign(local, obj);
        },
        remove: async (key: string) => {
          delete local[key];
        },
      },
    },
    // Emit synchronously, then resolve after a macrotask so the listener's
    // async read-modify-write of storage completes before the next emit (the
    // real listener serializes naturally via the event loop per commit).
    __emitNav: async (details: unknown) => {
      navListeners.forEach((l) => l(details));
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

const commit = (over: Record<string, unknown>) => ({
  tabId: 1,
  frameId: 0,
  url: 'https://site.com/page',
  transitionType: 'link',
  transitionQualifiers: [],
  ...over,
});

function nav(records: RecordEntry[]): Extract<RecordEntry, { kind: 'nav' }>[] {
  return records.filter((r): r is Extract<RecordEntry, { kind: 'nav' }> => r.kind === 'nav');
}

describe('navigation trace listener', () => {
  let fake: ReturnType<typeof fakeChrome>;

  beforeEach(() => {
    fake = fakeChrome();
    vi.stubGlobal('chrome', fake);
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    enableTrace();
  });

  afterEach(() => {
    disableTrace();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('tracks fromUrl across two navigations of the same tab', async () => {
    await fake.__emitNav(commit({ tabId: 1, url: 'https://bank.com/dashboard' }));
    await fake.__emitNav(commit({ tabId: 1, url: 'https://bank.com/login' }));

    const records = nav(await getRecords());
    expect(records).toHaveLength(2);
    expect(records[0].fromUrl).toBe(''); // first commit: prior url unknown
    expect(records[0].toUrl).toBe('https://bank.com/dashboard');
    expect(records[1].fromUrl).toBe('https://bank.com/dashboard');
    expect(records[1].toUrl).toBe('https://bank.com/login');
  });

  it('ignores sub-frame commits (frameId !== 0)', async () => {
    await fake.__emitNav(commit({ frameId: 1, url: 'https://ad.com/frame' }));
    expect(nav(await getRecords())).toHaveLength(0);
  });

  it("skips our own extension's pages", async () => {
    await fake.__emitNav(commit({ url: 'chrome-extension://tabbyid/src/review/review.html' }));
    expect(nav(await getRecords())).toHaveLength(0);
  });
});
