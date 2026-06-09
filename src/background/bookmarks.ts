// Bookmark lookup for the already-bookmarked close-recommendation signal
// (kata 3ndp). Worker-only: needs the "bookmarks" permission.

import { normalizeUrl } from '@/core';
import type { Settings } from '@/shared/types';

/**
 * All bookmarked URLs, normalized with the user's comparison options so a
 * tab and its bookmark match even when they differ by tracking params, www,
 * fragment, etc. Read fresh per call — the tree is small at review scale.
 */
export async function getBookmarkedUrlSet(
  normalize: Settings['normalize'],
): Promise<Set<string>> {
  const urls = new Set<string>();
  const walk = (nodes: chrome.bookmarks.BookmarkTreeNode[]): void => {
    for (const node of nodes) {
      if (node.url) urls.add(normalizeUrl(node.url, normalize).normalized);
      if (node.children) walk(node.children);
    }
  };
  walk(await chrome.bookmarks.getTree());
  return urls;
}
