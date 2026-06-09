import { afterEach, describe, expect, it, vi } from 'vitest';

import { getBookmarkedUrlSet } from '@/background/bookmarks';
import { settings } from '../helpers';

type Node = chrome.bookmarks.BookmarkTreeNode;

const folder = (children: Node[]): Node =>
  ({ id: 'f', title: 'folder', children }) as Node;
const bookmark = (url: string): Node => ({ id: 'b', title: url, url }) as Node;

function stubBookmarks(tree: Node[]): void {
  vi.stubGlobal('chrome', {
    bookmarks: { getTree: vi.fn().mockResolvedValue(tree) },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('getBookmarkedUrlSet', () => {
  it('collects urls from nested folders, normalized for comparison', async () => {
    stubBookmarks([
      folder([
        bookmark('https://www.example.com/article?utm_source=mail'),
        folder([bookmark('https://docs.example.com/guide/')]),
      ]),
    ]);
    const normalize = settings({ normalize: { ignoreWww: true } }).normalize;
    const set = await getBookmarkedUrlSet(normalize);
    expect(set.has('https://example.com/article')).toBe(true);
    expect(set.has('https://docs.example.com/guide')).toBe(true);
    expect(set.size).toBe(2);
  });

  it('returns an empty set for a bookmark-less tree', async () => {
    stubBookmarks([folder([])]);
    const set = await getBookmarkedUrlSet(settings().normalize);
    expect(set.size).toBe(0);
  });
});
