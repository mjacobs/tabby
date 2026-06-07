// Pure tab ordering — no Chrome APIs.
//
// Orders tabs so near-identical pages sit adjacent and are fast to scan, while
// respecting the two structural constraints of the tab strip:
//
//   1. Pinned tabs lead, in their original relative order (never reshuffled).
//   2. Tab groups stay contiguous — a group's tabs are sorted *within* the
//      group, and the group as a whole is positioned by its first member's key,
//      never interleaved with ungrouped tabs.
//
// Everything else is ordered lexically by sortKey (host → path → query).

import { normalizeUrl } from '@/core/normalizeUrl';
import type { Settings, TabInfo } from '@/shared/types';
import { byPosition, isGrouped } from '@/shared/tabs';

/** A schedulable unit: a single ungrouped tab, or a whole group. */
interface Unit {
  key: string;
  tabs: TabInfo[];
}

function compareUnits(a: Unit, b: Unit): number {
  if (a.key !== b.key) return a.key < b.key ? -1 : 1;
  return byPosition(a.tabs[0], b.tabs[0]);
}

export function sortTabs(tabs: TabInfo[], settings: Settings): TabInfo[] {
  const keyOf = (t: TabInfo) => normalizeUrl(t.url, settings.normalize).sortKey;
  const byKeyThenPosition = (a: TabInfo, b: TabInfo) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka !== kb) return ka < kb ? -1 : 1;
    return byPosition(a, b);
  };

  // Pinned tabs lead, in original order.
  const pinned = tabs.filter((t) => t.pinned).sort(byPosition);

  // Partition the rest into groups (preserving membership) and singletons.
  const groups = new Map<number, TabInfo[]>();
  const units: Unit[] = [];
  for (const tab of tabs) {
    if (tab.pinned) continue;
    if (isGrouped(tab)) {
      const bucket = groups.get(tab.groupId!);
      if (bucket) bucket.push(tab);
      else groups.set(tab.groupId!, [tab]);
    } else {
      units.push({ key: keyOf(tab), tabs: [tab] });
    }
  }

  // Each group becomes one unit, internally sorted, keyed by its first member.
  for (const members of groups.values()) {
    const sorted = [...members].sort(byKeyThenPosition);
    units.push({ key: keyOf(sorted[0]), tabs: sorted });
  }

  units.sort(compareUnits);

  return [...pinned, ...units.flatMap((u) => u.tabs)];
}
