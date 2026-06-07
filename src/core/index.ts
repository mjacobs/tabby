// Pure core logic — no Chrome APIs. Safe to import from anywhere and fully
// unit-testable. The background layer maps chrome.tabs.Tab → TabInfo and feeds
// these functions.

export { normalizeUrl } from '@/core/normalizeUrl';
export type { NormalizedUrl } from '@/core/normalizeUrl';
export { classifyUrl } from '@/core/urlCategory';
export type { UrlCategory } from '@/core/urlCategory';
export { dedupe } from '@/core/dedupe';
export type { DedupeResult, DuplicateGroup } from '@/core/dedupe';
export { sortTabs } from '@/core/sortTabs';
export { buildCleanupPlan } from '@/core/buildCleanupPlan';
export type {
  CleanupPlan,
  PlanInput,
  WindowSnapshot,
} from '@/core/buildCleanupPlan';
