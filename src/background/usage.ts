// Local, telemetry-free usage counts (g6gb).
//
// Purely-LOCAL tallies of how often Tabby's key actions run, persisted in
// chrome.storage.local so they survive worker restarts and can later inform
// default tuning. HARD REQUIREMENT: these counters are never transmitted — no
// network, no fetch/XHR, no external reporting, ever. They exist only so a
// human can read them back on this machine.
//
// Mirrors records.ts: the pure tally logic (`bumpCounts`) has no chrome.* deps
// so it is unit-testable; the storage glue (`bumpUsage`/`getUsage`/`clearUsage`)
// is thin.

import type { UsageCounts } from '@/shared/messages';

const USAGE_KEY = 'tabby:usage';

/**
 * The known usage events. A closed set so counters stay meaningful and typo
 * keys don't silently accumulate; callers pass one of these. `surface.*`
 * records which review surface a cleanup opened.
 */
export const USAGE_EVENTS = [
  'cleanupRun',
  'tabsClosed',
  'undo',
  'recommendationsShown',
  'recommendationsFlagged',
  'surface.page',
  'surface.sidepanel',
] as const;

export type UsageEvent = (typeof USAGE_EVENTS)[number];

/**
 * Return `counts` with `event` incremented by `n` (default 1). PURE — no
 * chrome.*, and the input map is never mutated, so it is safe to call on a map
 * read straight from storage. A non-positive `n` is a no-op (returns the input
 * unchanged) so a zero flagged/closed count never writes.
 */
export function bumpCounts(
  counts: UsageCounts,
  event: UsageEvent,
  n = 1,
): UsageCounts {
  if (n <= 0) return counts;
  return { ...counts, [event]: (counts[event] ?? 0) + n };
}

async function readUsage(): Promise<UsageCounts> {
  const stored = await chrome.storage.local.get(USAGE_KEY);
  return (stored[USAGE_KEY] as UsageCounts | undefined) ?? {};
}

/**
 * Increment `event` by `n` (default 1) in the persistent map with a single
 * storage read/write. A no-op (no write) when `n` is non-positive.
 */
export async function bumpUsage(event: UsageEvent, n = 1): Promise<void> {
  if (n <= 0) return;
  const next = bumpCounts(await readUsage(), event, n);
  await chrome.storage.local.set({ [USAGE_KEY]: next });
}

/** Return the full usage map (empty before anything is counted). */
export async function getUsage(): Promise<UsageCounts> {
  return readUsage();
}

/** Drop all usage counts. */
export async function clearUsage(): Promise<void> {
  await chrome.storage.local.remove(USAGE_KEY);
}
