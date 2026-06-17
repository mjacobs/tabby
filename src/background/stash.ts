// Stash reviewed tabs into a bookmark folder (2by6).
//
// v1 stash target is a top-level "Tabby Stash" bookmark folder: each stashed
// tab becomes one bookmark (title + url). The handler then closes the stashed
// tabs through the normal close+undo path, so a stash both SAVES the tabs and
// keeps them undoable. Worker-only: needs the "bookmarks" permission (already
// declared in manifest.config.ts and used by bookmarks.ts).
//
// The pure payload/dedup logic (`buildStashBookmarks`) has no chrome.* deps so
// it is unit-testable; the find-or-create folder glue below is thin.

import { normalizeUrl } from '@/core';
import type { Settings, TabInfo } from '@/shared/types';

/** Top-level bookmark folder Tabby stashes into; created on first stash. */
export const STASH_FOLDER_TITLE = 'Tabby Stash';

/** A single bookmark to create under the stash folder. */
export interface StashBookmark {
  title: string;
  url: string;
}

/**
 * Build the bookmarks to create for `tabs`, dropping tabs that have no real URL
 * and any whose normalized URL is already in `existing` (so re-stashing the same
 * page is a no-op rather than a duplicate). URLs are compared by `normalizeUrl`
 * with the user's options so a tab and its prior stash match even when they
 * differ by tracking params, www, fragment, etc. Duplicates within `tabs`
 * collapse to the first occurrence. PURE — no chrome.*.
 */
export function buildStashBookmarks(
  tabs: TabInfo[],
  existing: Set<string>,
  normalize: Settings['normalize'],
): StashBookmark[] {
  const out: StashBookmark[] = [];
  const seen = new Set(existing);
  for (const tab of tabs) {
    if (!tab.url) continue;
    const key = normalizeUrl(tab.url, normalize).normalized;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: tab.title || tab.url, url: tab.url });
  }
  return out;
}

/**
 * Find an existing "Tabby Stash" folder anywhere in the bookmark tree, or create
 * one. Returns its bookmark id. A folder is a node with children/no url; we walk
 * the whole tree (a create with no parentId lands in "Other Bookmarks", which is
 * itself nested under the root) so a folder created earlier is reused, not
 * duplicated.
 */
async function findOrCreateStashFolder(): Promise<string> {
  const find = (
    nodes: chrome.bookmarks.BookmarkTreeNode[],
  ): string | null => {
    for (const node of nodes) {
      if (!node.url && node.title === STASH_FOLDER_TITLE) return node.id;
      if (node.children) {
        const hit = find(node.children);
        if (hit) return hit;
      }
    }
    return null;
  };
  const existing = find(await chrome.bookmarks.getTree());
  if (existing) return existing;
  const created = await chrome.bookmarks.create({ title: STASH_FOLDER_TITLE });
  return created.id;
}

/**
 * Stash `tabs` into the "Tabby Stash" bookmark folder, one bookmark per tab.
 * Skips tabs without a URL and any already present in the folder (deduped via
 * `normalizeUrl`). Returns how many bookmarks were created.
 */
export async function stashTabs(
  tabs: TabInfo[],
  normalize: Settings['normalize'],
): Promise<number> {
  const folderId = await findOrCreateStashFolder();
  // URLs already in the stash folder, normalized for comparison so we don't add
  // a second bookmark for a page the user already stashed.
  const children = await chrome.bookmarks.getChildren(folderId);
  const existing = new Set(
    children
      .filter((c) => c.url)
      .map((c) => normalizeUrl(c.url!, normalize).normalized),
  );

  const toCreate = buildStashBookmarks(tabs, existing, normalize);
  for (const bm of toCreate) {
    await chrome.bookmarks.create({
      parentId: folderId,
      title: bm.title,
      url: bm.url,
    });
  }
  return toCreate.length;
}
