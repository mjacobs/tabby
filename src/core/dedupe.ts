// Pure duplicate detection — no Chrome APIs.
//
// Each tab is resolved to a dedup MODE based on its pinned/audible state and its
// URL category (see urlCategory.ts), then handled accordingly:
//
//   - 'dedup'    group by normalized URL; keep one, close the rest      (web)
//   - 'collapse' treat the whole category as one group; keep one        (blank, opt)
//   - 'purge'    close every tab of this category                       (blank, opt)
//   - 'protect'  set aside entirely; never grouped, never closed        (everything else)
//
// Two invariants hold across every mode:
//   1. The active tab of a window is NEVER closed (no rug-pulling), and is
//      preferred as the survivor within its group.
//   2. Protections are independent of category — a pinned or audible tab is
//      protected whatever its URL.

import { normalizeUrl } from '@/core/normalizeUrl';
import { classifyUrl } from '@/core/urlCategory';
import type { KeepPolicy, Settings, TabInfo } from '@/shared/types';
import { byPosition } from '@/shared/tabs';

export interface DuplicateGroup {
  /** The grouping key shared by every member (normalized URL, or category). */
  normalized: string;
  /** The surviving tab. */
  keep: TabInfo;
  /** Tabs marked for closing (the duplicates). */
  close: TabInfo[];
}

export interface DedupeResult {
  /** Every surviving tab, in original input order. */
  keep: TabInfo[];
  /** Every tab marked for closing, in original input order. */
  close: TabInfo[];
  /** Only groups that actually closed something (dedup/collapse). */
  duplicateGroups: DuplicateGroup[];
}

type DedupMode = 'dedup' | 'collapse' | 'purge' | 'protect';

/** Synthetic key under which all blanks bucket together in 'collapse' mode. */
const BLANK_GROUP_KEY = 'about:blank';

function resolveMode(tab: TabInfo, settings: Settings): DedupMode {
  // Protections win over category, and apply to any URL.
  if (settings.protectPinned && tab.pinned) return 'protect';
  if (settings.protectAudible && tab.audible) return 'protect';

  switch (classifyUrl(tab.url)) {
    case 'web':
      return 'dedup';
    case 'blank':
      // BlankTabPolicy values are a subset of DedupMode by construction.
      return settings.blankTabPolicy;
    // browser / extension / file / other are protected for now; each is a
    // distinct category so it can grow its own policy later.
    default:
      return 'protect';
  }
}

/**
 * Returns true if `a` is the better keeper than `b` under `policy`. The active
 * tab always wins; ties otherwise fall back to original position so output is
 * deterministic.
 */
function isBetterKeeper(a: TabInfo, b: TabInfo, policy: KeepPolicy): boolean {
  if (a.active !== b.active) return a.active;
  if (policy === 'leftmost') return byPosition(a, b) < 0;

  const aTime = a.lastAccessed ?? 0;
  const bTime = b.lastAccessed ?? 0;
  if (aTime !== bTime) {
    return policy === 'most-recent' ? aTime > bTime : aTime < bTime;
  }
  return byPosition(a, b) < 0;
}

export function dedupe(tabs: TabInfo[], settings: Settings): DedupeResult {
  const groups = new Map<string, TabInfo[]>();
  const closeIds = new Set<number>();

  for (const tab of tabs) {
    const mode = resolveMode(tab, settings);
    if (mode === 'protect') continue;

    if (mode === 'purge') {
      if (!tab.active) closeIds.add(tab.id); // invariant 1: never close active
      continue;
    }

    const key =
      mode === 'collapse'
        ? BLANK_GROUP_KEY
        : normalizeUrl(tab.url, settings.normalize).normalized;
    const bucket = groups.get(key);
    if (bucket) bucket.push(tab);
    else groups.set(key, [tab]);
  }

  const duplicateGroups: DuplicateGroup[] = [];

  for (const [normalized, members] of groups) {
    if (members.length < 2) continue;

    let keeper = members[0];
    for (const candidate of members.slice(1)) {
      if (isBetterKeeper(candidate, keeper, settings.keepPolicy)) {
        keeper = candidate;
      }
    }

    // Close every duplicate except the keeper — and never the active tab.
    const close = members.filter((t) => t !== keeper && !t.active);
    if (close.length === 0) continue;

    for (const t of close) closeIds.add(t.id);
    duplicateGroups.push({ normalized, keep: keeper, close });
  }

  return {
    keep: tabs.filter((t) => !closeIds.has(t.id)),
    close: tabs.filter((t) => closeIds.has(t.id)),
    duplicateGroups,
  };
}
