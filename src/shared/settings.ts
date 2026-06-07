import type { Settings } from '@/shared/types';
import { DEFAULT_TRACKING_PARAMS } from '@/shared/urlPatterns';

export const DEFAULT_SETTINGS: Settings = {
  normalize: {
    dropFragment: true,
    stripTrackingParams: true,
    dropTrailingSlash: true,
    ignoreWww: false,
    stripAllQuery: false,
    trackingParams: DEFAULT_TRACKING_PARAMS,
  },
  keepPolicy: 'most-recent',
  protectPinned: true,
  protectAudible: false,
  preserveGroups: true,
  consolidateTarget: 'focused-window',
  confirmBeforeCommit: false,
};

/** Load settings from chrome.storage.sync, merged over defaults. */
export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...(stored.settings as Partial<Settings>) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ settings });
}
