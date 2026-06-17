import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  STASH_FOLDER_TITLE,
  buildStashBookmarks,
  stashTabs,
} from '@/background/stash';
import { settings, tab } from '../helpers';

describe('buildStashBookmarks (pure)', () => {
  const normalize = settings().normalize;

  it('builds one bookmark per tab (title + url)', () => {
    const tabs = [
      tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
      tab({ id: 2, url: 'https://b.com', title: 'Beta' }),
    ];
    expect(buildStashBookmarks(tabs, new Set(), normalize)).toEqual([
      { title: 'Alpha', url: 'https://a.com' },
      { title: 'Beta', url: 'https://b.com' },
    ]);
  });

  it('skips tabs without a real url', () => {
    const tabs = [
      tab({ id: 1, url: '', title: 'Blank' }),
      tab({ id: 2, url: 'https://b.com', title: 'Beta' }),
    ];
    expect(buildStashBookmarks(tabs, new Set(), normalize)).toEqual([
      { title: 'Beta', url: 'https://b.com' },
    ]);
  });

  it('falls back to the url when the tab has no title', () => {
    const tabs = [tab({ id: 1, url: 'https://a.com', title: '' })];
    expect(buildStashBookmarks(tabs, new Set(), normalize)).toEqual([
      { title: 'https://a.com', url: 'https://a.com' },
    ]);
  });

  it('drops tabs already in the stash, compared via normalizeUrl', () => {
    const norm = settings({ normalize: { ignoreWww: true } }).normalize;
    // The stash already holds the www-stripped form of a.com.
    const existing = new Set(['https://a.com/']);
    const tabs = [
      tab({ id: 1, url: 'https://www.a.com/', title: 'Alpha (www)' }),
      tab({ id: 2, url: 'https://b.com/', title: 'Beta' }),
    ];
    expect(buildStashBookmarks(tabs, existing, norm)).toEqual([
      { title: 'Beta', url: 'https://b.com/' },
    ]);
  });

  it('collapses duplicate urls within the same batch to the first occurrence', () => {
    const tabs = [
      tab({ id: 1, url: 'https://a.com', title: 'First' }),
      tab({ id: 2, url: 'https://a.com', title: 'Second' }),
    ];
    expect(buildStashBookmarks(tabs, new Set(), normalize)).toEqual([
      { title: 'First', url: 'https://a.com' },
    ]);
  });
});

// --- stashTabs against a stubbed chrome.bookmarks ----------------------------

interface FakeNode {
  id: string;
  title: string;
  url?: string;
  parentId?: string;
  children?: FakeNode[];
}

/**
 * Minimal in-memory chrome.bookmarks: a single root ('0') with a bookmark-bar
 * child ('1') that new top-level folders/bookmarks are created under. Enough to
 * exercise find-or-create + getChildren + create.
 */
function fakeBookmarks() {
  const bar: FakeNode = { id: '1', title: 'Bookmarks bar', children: [] };
  const root: FakeNode = { id: '0', title: '', children: [bar] };
  const byId = new Map<string, FakeNode>([
    ['0', root],
    ['1', bar],
  ]);
  let nextId = 2;
  return {
    _root: root,
    _bar: bar,
    getTree: vi.fn(async () => [root]),
    getChildren: vi.fn(async (id: string) => byId.get(id)?.children ?? []),
    create: vi.fn(
      async (b: { parentId?: string; title?: string; url?: string }) => {
        const node: FakeNode = {
          id: String(nextId++),
          title: b.title ?? '',
          url: b.url,
          parentId: b.parentId ?? '1',
        };
        const parent = byId.get(node.parentId!) ?? bar;
        (parent.children ??= []).push(node);
        byId.set(node.id, node);
        return node;
      },
    ),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('stashTabs', () => {
  it('creates the stash folder on first stash and adds a bookmark per tab', async () => {
    const bm = fakeBookmarks();
    vi.stubGlobal('chrome', { bookmarks: bm });

    const n = await stashTabs(
      [
        tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
        tab({ id: 2, url: 'https://b.com', title: 'Beta' }),
      ],
      settings().normalize,
    );

    expect(n).toBe(2);
    // The folder was created, then two bookmarks under it.
    const folder = bm._bar.children?.find(
      (c) => !c.url && c.title === STASH_FOLDER_TITLE,
    );
    expect(folder).toBeDefined();
    expect(folder!.children?.map((c) => c.url)).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('reuses an existing folder and skips urls already stashed', async () => {
    const bm = fakeBookmarks();
    vi.stubGlobal('chrome', { bookmarks: bm });

    // First stash creates the folder with a.com + b.com.
    await stashTabs(
      [
        tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
        tab({ id: 2, url: 'https://b.com', title: 'Beta' }),
      ],
      settings().normalize,
    );
    // Second stash re-adds a.com (skipped) plus a new c.com.
    const n = await stashTabs(
      [
        tab({ id: 1, url: 'https://a.com', title: 'Alpha again' }),
        tab({ id: 3, url: 'https://c.com', title: 'Gamma' }),
      ],
      settings().normalize,
    );

    expect(n).toBe(1); // only c.com was new
    const folders = bm._bar.children?.filter(
      (c) => !c.url && c.title === STASH_FOLDER_TITLE,
    );
    expect(folders).toHaveLength(1); // reused, not duplicated
    expect(folders![0].children?.map((c) => c.url)).toEqual([
      'https://a.com',
      'https://b.com',
      'https://c.com',
    ]);
  });

  it('stashes nothing (and creates no bookmarks) for an empty tab set', async () => {
    const bm = fakeBookmarks();
    vi.stubGlobal('chrome', { bookmarks: bm });

    const n = await stashTabs([], settings().normalize);
    expect(n).toBe(0);
    const folder = bm._bar.children?.find(
      (c) => !c.url && c.title === STASH_FOLDER_TITLE,
    );
    // The folder is created (find-or-create), but holds no bookmarks.
    expect(folder?.children ?? []).toEqual([]);
  });
});
