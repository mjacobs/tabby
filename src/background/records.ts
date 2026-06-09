// Persistent records log (e6f0).
//
// A capped, append-only trail of what Tabby recommended/closed and why, plus
// opt-in navigation-trace ('nav') entries that seed the stranded-auth pattern
// set (docs/close-recommendation-design.md, signal 1). Unlike the vpn4 state
// log — a session ring buffer for debugging — records persist in
// chrome.storage.local so they survive worker restarts and can be harvested
// later.
//
// The pure ring/cap logic (`appendCapped`) has no chrome.* deps so it is
// unit-testable; the storage glue (`appendRecords`/`getRecords`/`clearRecords`)
// is thin.

import type { RecordEntry } from '@/shared/messages';
import type { Recommendation } from '@/core/recommend';
import type { TabInfo } from '@/shared/types';

const RECORDS_KEY = 'tabby:records';
const MAX_RECORDS = 1000;

/**
 * Append `entries` to `log`, keeping at most `max` (dropping oldest). PURE —
 * no chrome.*; the batched glue below calls this once per write.
 */
export function appendCapped(
  log: RecordEntry[],
  entries: RecordEntry[],
  max = MAX_RECORDS,
): RecordEntry[] {
  if (entries.length === 0) return log;
  const next = [...log, ...entries];
  return next.length > max ? next.slice(next.length - max) : next;
}

async function readRecords(): Promise<RecordEntry[]> {
  const stored = await chrome.storage.local.get(RECORDS_KEY);
  return (stored[RECORDS_KEY] as RecordEntry[] | undefined) ?? [];
}

/**
 * Append a batch of entries to the persistent log with a single storage
 * read/write. A no-op (no write) when `entries` is empty.
 */
export async function appendRecords(entries: RecordEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const next = appendCapped(await readRecords(), entries);
  await chrome.storage.local.set({ [RECORDS_KEY]: next });
}

/** Return the full persistent log (oldest first). */
export async function getRecords(): Promise<RecordEntry[]> {
  return readRecords();
}

/** Drop the entire persistent log. */
export async function clearRecords(): Promise<void> {
  await chrome.storage.local.remove(RECORDS_KEY);
}

// --- Pure record builders (no chrome.*) -------------------------------------
//
// Factored out of the message handlers so the entry shapes can be unit-tested
// directly. The handlers map their inputs and append the result.

/**
 * One 'recommendation' entry per flagged tab, carrying that tab's URL (looked
 * up from `tabs` by id) and reasons. Recommendations whose tab is missing from
 * `tabs` get an empty url. PURE.
 */
export function buildRecommendationRecords(
  recommendations: Recommendation[],
  tabs: TabInfo[],
  at: number,
): RecordEntry[] {
  const urlById = new Map(tabs.map((t) => [t.id, t.url]));
  return recommendations.map((r) => ({
    at,
    kind: 'recommendation',
    tabId: r.tabId,
    url: urlById.get(r.tabId) ?? '',
    reasons: r.reasons,
  }));
}

/** A single 'close' entry with the closed tabs' ids and urls. PURE. */
export function buildCloseRecord(closed: TabInfo[], at: number): RecordEntry {
  return {
    at,
    kind: 'close',
    tabIds: closed.map((t) => t.id),
    urls: closed.map((t) => t.url),
  };
}

/** A single 'undo' entry with how many tabs were restored. PURE. */
export function buildUndoRecord(restored: number, at: number): RecordEntry {
  return { at, kind: 'undo', restored };
}
