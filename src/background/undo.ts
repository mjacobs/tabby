// Undo buffer for closed tabs, backed by chrome.storage.session so it survives
// service-worker restarts (but clears when the browser closes). Each entry is a
// batch (one auto-dedup run or one manual commit), restored LIFO.
//
// The storage buffer is the source of truth for WHAT to restore (url/title/
// pinned). On top of it we record each closed tab's chrome.sessions sessionId
// when we can match one, so undo can restore via chrome.sessions.restore and
// bring back the tab's back/forward history (DESIGN §2.6). When no session
// matches (or the restore fails because it expired) we fall back to recreating
// the URL. recordClosed must be called AFTER the tabs are actually removed, so
// the just-closed tabs are present in chrome.sessions.getRecentlyClosed.

import type { TabInfo } from '@/shared/types';

const UNDO_KEY = 'tabby:undo';

// chrome.sessions.MAX_SESSION_RESULTS is 25; ask for the full window.
const MAX_RECENT = 25;
// Only trust a recently-closed entry captured within this window of the close,
// so a stale entry with the same URL (closed earlier) isn't mistaken for ours.
const MATCH_WINDOW_MS = 60_000;

interface ClosedTab {
  url: string;
  title: string;
  pinned: boolean;
  /** chrome.sessions id captured just after close; restores with history. */
  sessionId?: string;
}

async function readBuffer(): Promise<ClosedTab[][]> {
  const stored = await chrome.storage.session.get(UNDO_KEY);
  return (stored[UNDO_KEY] as ClosedTab[][] | undefined) ?? [];
}

/**
 * Fill in sessionIds for a batch of closed tabs from recently-closed sessions.
 * PURE. Most-recent match wins (getRecentlyClosed is most-recent-first), each
 * session is used at most once (so duplicate URLs map to distinct sessions),
 * and entries older than `windowMs` are ignored as stale. Returns a new batch.
 */
export function attachSessionIds(
  batch: ClosedTab[],
  sessions: chrome.sessions.Session[],
  nowMs: number,
  windowMs: number,
): ClosedTab[] {
  // Fresh tab-close sessions, most-recent first, as {url, sessionId} candidates.
  const candidates = sessions
    .filter(
      (s) =>
        s.tab?.url != null &&
        s.tab.sessionId != null &&
        nowMs - s.lastModified * 1000 <= windowMs,
    )
    .map((s) => ({ url: s.tab!.url!, sessionId: s.tab!.sessionId!, used: false }));

  return batch.map((tab) => {
    if (tab.sessionId != null) return tab;
    const hit = candidates.find((c) => !c.used && c.url === tab.url);
    if (!hit) return tab;
    hit.used = true;
    return { ...tab, sessionId: hit.sessionId };
  });
}

/** Look up the just-closed tabs in chrome.sessions; best-effort, never throws. */
async function withSessionIds(batch: ClosedTab[]): Promise<ClosedTab[]> {
  if (!chrome.sessions?.getRecentlyClosed) return batch;
  try {
    const sessions = await chrome.sessions.getRecentlyClosed({
      maxResults: MAX_RECENT,
    });
    return attachSessionIds(batch, sessions, Date.now(), MATCH_WINDOW_MS);
  } catch {
    return batch;
  }
}

/**
 * Record a batch of just-closed tabs. Tabs without a real URL are skipped.
 * Call this AFTER the tabs are removed so their chrome.sessions entries exist.
 */
export async function recordClosed(tabs: TabInfo[]): Promise<void> {
  const batch: ClosedTab[] = tabs
    .filter((t) => t.url)
    .map((t) => ({ url: t.url, title: t.title, pinned: t.pinned }));
  if (batch.length === 0) return;

  const enriched = await withSessionIds(batch);
  const buffer = await readBuffer();
  buffer.push(enriched);
  await chrome.storage.session.set({ [UNDO_KEY]: buffer });
}

/** Recreate a closed tab from its stored URL (the no-history fallback path). */
async function recreate(tab: ClosedTab): Promise<void> {
  await chrome.tabs.create({ url: tab.url, pinned: tab.pinned, active: false });
}

/** Restore the most recently closed batch. Returns how many tabs reopened. */
export async function undoLast(): Promise<number> {
  const buffer = await readBuffer();
  const batch = buffer.pop();
  if (!batch) return 0;

  await chrome.storage.session.set({ [UNDO_KEY]: buffer });

  // Remember where the user was (the review page they triggered undo from).
  // chrome.sessions.restore activates each tab it reopens, so restoring a batch
  // would otherwise scatter focus onto an arbitrary restored tab; we put focus
  // back afterward so the user keeps the holistic view of the change.
  const [activeBefore] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });

  let restored = 0;
  for (const tab of batch) {
    try {
      if (tab.sessionId != null && chrome.sessions?.restore) {
        // Restores the tab with its back/forward history intact.
        await chrome.sessions.restore(tab.sessionId);
      } else {
        await recreate(tab);
      }
      restored++;
    } catch {
      // The session may have expired since close — fall back to the URL.
      try {
        await recreate(tab);
        restored++;
      } catch {
        // Couldn't reopen (e.g. restricted URL) — skip it.
      }
    }
  }

  // Return focus to where the user was before the restores stole it.
  if (activeBefore?.id != null) {
    try {
      await chrome.tabs.update(activeBefore.id, { active: true });
      if (activeBefore.windowId != null) {
        await chrome.windows.update(activeBefore.windowId, { focused: true });
      }
    } catch {
      // The tab/window vanished — nothing to refocus.
    }
  }

  return restored;
}
