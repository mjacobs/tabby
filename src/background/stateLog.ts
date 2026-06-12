// Structured canonical tab-state logging (vpn4).
//
// Captures a stable, diff-friendly snapshot of tab state at operation
// boundaries to make state-divergence bugs (e.g. the stale-snapshot bug)
// diagnosable WITHOUT a browser/DevTools round-trip. When Settings.debugLogging
// is on, each snapshot is emitted via console.debug and retained in a session
// ring buffer; the `dumpState` message returns the live state plus the buffer.
//
// `serializeState` and `pushToBuffer` are pure (no chrome.*) so they're
// unit-testable; the chrome glue (live snapshot, storage) is thin.

import { normalizeUrl } from '@/core/normalizeUrl';
import type { WindowSnapshot } from '@/core/buildCleanupPlan';
import { snapshotWindows } from '@/background/snapshot';
import { getReview } from '@/background/reviewStore';
import { loadSettings } from '@/shared/settings';
import type {
  CanonicalSnapshot,
  CanonicalWindow,
  ReviewState,
  StateDump,
} from '@/shared/messages';
import type { Settings } from '@/shared/types';

const LOG_KEY = 'tabby:stateLog';
const MAX_SNAPSHOTS = 20;

/**
 * Build a canonical snapshot from in-memory data. PURE — deterministic
 * ordering (windows by id, tabs by index) and a fixed field set so two
 * snapshots diff meaningfully.
 */
export function serializeState(
  windows: WindowSnapshot[],
  settings: Settings,
  review: ReviewState | null,
  label: string,
  capturedAt: number,
): CanonicalSnapshot {
  const canonicalWindows: CanonicalWindow[] = [...windows]
    .sort((a, b) => a.id - b.id)
    .map((w) => ({
      id: w.id,
      focused: w.focused,
      tabs: [...w.tabs]
        .sort((a, b) => a.index - b.index)
        .map((t) => ({
          id: t.id,
          index: t.index,
          windowId: t.windowId,
          pinned: t.pinned,
          groupId: t.groupId,
          active: t.active,
          lastAccessed: t.lastAccessed,
          urlRaw: t.url,
          urlNormalized: normalizeUrl(t.url, settings.normalize).normalized,
          title: t.title,
        })),
    }));
  return { label, capturedAt, windows: canonicalWindows, review };
}

/** Append a snapshot to the ring buffer, dropping oldest past `max`. PURE. */
export function pushToBuffer(
  buffer: CanonicalSnapshot[],
  snap: CanonicalSnapshot,
  max = MAX_SNAPSHOTS,
): CanonicalSnapshot[] {
  const next = [...buffer, snap];
  return next.length > max ? next.slice(next.length - max) : next;
}

async function readBuffer(): Promise<CanonicalSnapshot[]> {
  const stored = await chrome.storage.session.get(LOG_KEY);
  return (stored[LOG_KEY] as CanonicalSnapshot[] | undefined) ?? [];
}

async function writeBuffer(buffer: CanonicalSnapshot[]): Promise<void> {
  await chrome.storage.session.set({ [LOG_KEY]: buffer });
}

/**
 * Capture and record a canonical snapshot at an operation boundary. No-op when
 * Settings.debugLogging is off (cheap: only a settings read). Callers that
 * already have the window snapshot / settings may pass them to avoid re-querying.
 */
export async function logState(
  label: string,
  opts: { windows?: WindowSnapshot[]; settings?: Settings } = {},
): Promise<void> {
  const settings = opts.settings ?? (await loadSettings());
  if (!settings.debugLogging) return;

  const windows = opts.windows ?? (await snapshotWindows());
  const review = await getReview();
  const snap = serializeState(windows, settings, review, label, Date.now());

  console.debug('[tabby:state]', label, snap);
  await writeBuffer(pushToBuffer(await readBuffer(), snap));
}

/**
 * Return the current live canonical state plus the retained buffer. Always
 * works (independent of debugLogging) so an agent/test can read state on demand;
 * the buffer is only populated while debugLogging has been on.
 */
export async function dumpState(): Promise<StateDump> {
  const settings = await loadSettings();
  const windows = await snapshotWindows();
  const review = await getReview();
  const current = serializeState(windows, settings, review, 'dumpState', Date.now());
  return { current, buffer: await readBuffer() };
}
