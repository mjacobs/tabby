import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerMessageHandlers } from '@/background/messageHandlers';
import { STASH_FOLDER_TITLE } from '@/background/stash';
import type { RecordEntry, ViewRequest } from '@/shared/messages';

// --- A fake chrome covering just what the stashClose path touches ------------
//
// stashClose flows through: chrome.tabs.get (gather), chrome.bookmarks.* (stash),
// loadSettings (storage.sync), chrome.tabs.remove + recordClosed (storage.session
// + sessions), appendRecords (storage.local), logState (no-op while debugLogging
// is off). We assert: a stash folder + bookmarks were created, the tabs were
// removed, and a 'stash' record was appended.

interface FakeBookmarkNode {
  id: string;
  title: string;
  url?: string;
  parentId?: string;
  children?: FakeBookmarkNode[];
}

function fakeChrome(tabs: Record<number, { url: string; title: string }>) {
  const session: Record<string, unknown> = {};
  const local: Record<string, unknown> = {};
  const sync: Record<string, unknown> = {};
  const removed: number[][] = [];

  const bar: FakeBookmarkNode = { id: '1', title: 'Bookmarks bar', children: [] };
  const root: FakeBookmarkNode = { id: '0', title: '', children: [bar] };
  const bmById = new Map<string, FakeBookmarkNode>([
    ['0', root],
    ['1', bar],
  ]);
  let nextBmId = 2;

  const store = (bag: Record<string, unknown>) => ({
    get: async (key: string) => ({ [key]: bag[key] }),
    set: async (obj: Record<string, unknown>) => {
      Object.assign(bag, obj);
    },
    remove: async (key: string) => {
      delete bag[key];
    },
  });

  const chrome = {
    _bar: bar,
    _removed: removed,
    _local: local,
    storage: { session: store(session), local: store(local), sync: store(sync) },
    tabs: {
      get: async (id: number) => {
        const t = tabs[id];
        if (!t) throw new Error('no such tab');
        return { id, windowId: 1, index: id, pinned: false, active: false, ...t };
      },
      remove: async (ids: number[]) => {
        removed.push(ids);
      },
    },
    bookmarks: {
      getTree: async () => [root],
      getChildren: async (id: string) => bmById.get(id)?.children ?? [],
      create: async (b: { parentId?: string; title?: string; url?: string }) => {
        const node: FakeBookmarkNode = {
          id: String(nextBmId++),
          title: b.title ?? '',
          url: b.url,
          parentId: b.parentId ?? '1',
        };
        const parent = bmById.get(node.parentId!) ?? bar;
        (parent.children ??= []).push(node);
        bmById.set(node.id, node);
        return node;
      },
    },
    // recordClosed checks for getRecentlyClosed; omit it so it takes the
    // url-only fallback path (no sessions matched).
    sessions: {},
    runtime: {
      _listener: null as
        | ((msg: ViewRequest, sender: unknown, respond: (r: unknown) => void) => boolean)
        | null,
      onMessage: {
        addListener(
          fn: (msg: ViewRequest, sender: unknown, respond: (r: unknown) => void) => boolean,
        ) {
          chrome.runtime._listener = fn;
        },
      },
    },
  };
  return chrome;
}

/** Drive a request through the registered onMessage listener; resolve its response. */
function send(chrome: ReturnType<typeof fakeChrome>, msg: ViewRequest): Promise<unknown> {
  return new Promise((resolve) => {
    chrome.runtime._listener!(msg, {}, resolve);
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('stashClose handler', () => {
  it('stashes the tabs to a bookmark folder, closes them, and logs a stash record', async () => {
    const chrome = fakeChrome({
      1: { url: 'https://a.com', title: 'Alpha' },
      2: { url: 'https://b.com', title: 'Beta' },
    });
    vi.stubGlobal('chrome', chrome);
    registerMessageHandlers();

    const res = (await send(chrome, { type: 'stashClose', tabIds: [1, 2] })) as {
      stashed: number;
      closed: number;
    };

    expect(res).toEqual({ stashed: 2, closed: 2 });

    // A "Tabby Stash" folder was created with one bookmark per tab.
    const folder = chrome._bar.children?.find(
      (c) => !c.url && c.title === STASH_FOLDER_TITLE,
    );
    expect(folder).toBeDefined();
    expect(folder!.children?.map((c) => c.url)).toEqual([
      'https://a.com',
      'https://b.com',
    ]);

    // The tabs were removed.
    expect(chrome._removed).toEqual([[1, 2]]);

    // A 'stash' record was appended to the persistent log.
    const records = (chrome._local['tabby:records'] as RecordEntry[]) ?? [];
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      kind: 'stash',
      tabIds: [1, 2],
      urls: ['https://a.com', 'https://b.com'],
    });

    // The closed tabs are in the undo buffer, so the stash stays undoable.
    const undoBuffer =
      (await chrome.storage.session.get('tabby:undo'))['tabby:undo'];
    expect(undoBuffer).toBeTruthy();
  });
});
