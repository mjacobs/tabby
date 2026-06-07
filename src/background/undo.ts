// Undo buffer for closed tabs, backed by chrome.storage.session so it survives
// service-worker restarts (but clears when the browser closes). Each entry is a
// batch (one auto-dedup run or one manual commit), restored LIFO.
//
// v1 restores by recreating the URL. chrome.sessions.restore (which preserves
// history/scroll) is a future enhancement — see DESIGN §2.6.

import type { TabInfo } from '@/shared/types';

const UNDO_KEY = 'tabby:undo';

interface ClosedTab {
  url: string;
  title: string;
  pinned: boolean;
}

async function readBuffer(): Promise<ClosedTab[][]> {
  const stored = await chrome.storage.session.get(UNDO_KEY);
  return (stored[UNDO_KEY] as ClosedTab[][] | undefined) ?? [];
}

/** Record a batch of about-to-close tabs. Tabs without a real URL are skipped. */
export async function recordClosed(tabs: TabInfo[]): Promise<void> {
  const batch: ClosedTab[] = tabs
    .filter((t) => t.url)
    .map((t) => ({ url: t.url, title: t.title, pinned: t.pinned }));
  if (batch.length === 0) return;

  const buffer = await readBuffer();
  buffer.push(batch);
  await chrome.storage.session.set({ [UNDO_KEY]: buffer });
}

/** Restore the most recently closed batch. Returns how many tabs reopened. */
export async function undoLast(): Promise<number> {
  const buffer = await readBuffer();
  const batch = buffer.pop();
  if (!batch) return 0;

  await chrome.storage.session.set({ [UNDO_KEY]: buffer });

  let restored = 0;
  for (const tab of batch) {
    try {
      await chrome.tabs.create({ url: tab.url, pinned: tab.pinned, active: false });
      restored++;
    } catch {
      // Couldn't reopen (e.g. restricted URL) — skip it.
    }
  }
  return restored;
}
