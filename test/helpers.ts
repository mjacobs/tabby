import type { Settings, TabInfo } from '@/shared/types';
import { DEFAULT_SETTINGS } from '@/shared/settings';

let nextId = 1;

/** Build a TabInfo with sensible defaults; override only what a test cares about. */
export function tab(overrides: Partial<TabInfo> = {}): TabInfo {
  const id = overrides.id ?? nextId++;
  return {
    id,
    windowId: 1,
    index: id,
    url: `https://example.com/${id}`,
    title: `Tab ${id}`,
    pinned: false,
    audible: false,
    active: false,
    ...overrides,
  };
}

/** Settings with deep-merged overrides for the common nested `normalize` block. */
type SettingsOverrides = Partial<Omit<Settings, 'normalize'>> & {
  normalize?: Partial<Settings['normalize']>;
};

export function settings(overrides: SettingsOverrides = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
    normalize: { ...DEFAULT_SETTINGS.normalize, ...overrides.normalize },
  };
}

export const ids = (tabs: TabInfo[]): number[] => tabs.map((t) => t.id);
