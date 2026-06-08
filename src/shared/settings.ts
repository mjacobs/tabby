import type {
  BlankTabPolicy,
  ConsolidateTarget,
  KeepPolicy,
  Settings,
} from '@/shared/types';
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
  blankTabPolicy: 'purge',
  preserveGroups: true,
  consolidateTarget: 'focused-window',
  confirmBeforeCommit: false,
  debugLogging: false,
};

/** Load settings from chrome.storage.sync, merged over defaults. */
export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...(stored.settings as Partial<Settings>) };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ settings });
}

// --- Import/export validation (pure; used by the options page and the
// `importSettings` control message) ------------------------------------------

const KEEP_POLICIES: readonly KeepPolicy[] = ['most-recent', 'oldest', 'leftmost'];
const BLANK_POLICIES: readonly BlankTabPolicy[] = ['purge', 'collapse', 'protect'];
const CONSOLIDATE_TARGETS: readonly ConsolidateTarget[] = [
  'focused-window',
  'new-window',
];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function coerceBool(
  v: unknown,
  fallback: boolean,
  path: string,
  warnings: string[],
): boolean {
  if (typeof v === 'boolean') return v;
  if (v !== undefined) warnings.push(`${path}: expected boolean, kept default`);
  return fallback;
}

function coerceEnum<T extends string>(
  v: unknown,
  allowed: readonly T[],
  fallback: T,
  path: string,
  warnings: string[],
): T {
  if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) {
    return v as T;
  }
  if (v !== undefined) warnings.push(`${path}: invalid value, kept default`);
  return fallback;
}

function coerceStringArray(
  v: unknown,
  fallback: string[],
  path: string,
  warnings: string[],
): string[] {
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) {
    return v as string[];
  }
  if (v !== undefined) warnings.push(`${path}: expected string[], kept default`);
  return fallback;
}

const TOP_LEVEL_KEYS = new Set<keyof Settings>([
  'normalize',
  'keepPolicy',
  'protectPinned',
  'protectAudible',
  'blankTabPolicy',
  'preserveGroups',
  'consolidateTarget',
  'confirmBeforeCommit',
  'debugLogging',
]);

const NORMALIZE_KEYS = new Set<keyof Settings['normalize']>([
  'dropFragment',
  'stripTrackingParams',
  'dropTrailingSlash',
  'ignoreWww',
  'stripAllQuery',
  'trackingParams',
]);

/**
 * Validate untrusted JSON into a complete, valid `Settings`, merging field by
 * field over `DEFAULT_SETTINGS`. Invalid/missing fields fall back to the
 * default and are reported in `warnings`; unknown keys are ignored (warned).
 * Pure — no Chrome APIs — so it is unit-testable and reusable by the worker.
 */
export function coerceSettings(input: unknown): {
  settings: Settings;
  warnings: string[];
} {
  const warnings: string[] = [];
  const d = DEFAULT_SETTINGS;

  if (!isPlainObject(input)) {
    warnings.push('root: not an object, using defaults');
    return {
      settings: { ...d, normalize: { ...d.normalize } },
      warnings,
    };
  }

  let nIn: Record<string, unknown> = {};
  if (isPlainObject(input.normalize)) {
    nIn = input.normalize;
  } else if (input.normalize !== undefined) {
    warnings.push('normalize: expected object, kept defaults');
  }

  const normalize: Settings['normalize'] = {
    dropFragment: coerceBool(
      nIn.dropFragment,
      d.normalize.dropFragment,
      'normalize.dropFragment',
      warnings,
    ),
    stripTrackingParams: coerceBool(
      nIn.stripTrackingParams,
      d.normalize.stripTrackingParams,
      'normalize.stripTrackingParams',
      warnings,
    ),
    dropTrailingSlash: coerceBool(
      nIn.dropTrailingSlash,
      d.normalize.dropTrailingSlash,
      'normalize.dropTrailingSlash',
      warnings,
    ),
    ignoreWww: coerceBool(
      nIn.ignoreWww,
      d.normalize.ignoreWww,
      'normalize.ignoreWww',
      warnings,
    ),
    stripAllQuery: coerceBool(
      nIn.stripAllQuery,
      d.normalize.stripAllQuery,
      'normalize.stripAllQuery',
      warnings,
    ),
    trackingParams: coerceStringArray(
      nIn.trackingParams,
      d.normalize.trackingParams,
      'normalize.trackingParams',
      warnings,
    ),
  };

  const settings: Settings = {
    normalize,
    keepPolicy: coerceEnum(
      input.keepPolicy,
      KEEP_POLICIES,
      d.keepPolicy,
      'keepPolicy',
      warnings,
    ),
    protectPinned: coerceBool(
      input.protectPinned,
      d.protectPinned,
      'protectPinned',
      warnings,
    ),
    protectAudible: coerceBool(
      input.protectAudible,
      d.protectAudible,
      'protectAudible',
      warnings,
    ),
    blankTabPolicy: coerceEnum(
      input.blankTabPolicy,
      BLANK_POLICIES,
      d.blankTabPolicy,
      'blankTabPolicy',
      warnings,
    ),
    preserveGroups: coerceBool(
      input.preserveGroups,
      d.preserveGroups,
      'preserveGroups',
      warnings,
    ),
    consolidateTarget: coerceEnum(
      input.consolidateTarget,
      CONSOLIDATE_TARGETS,
      d.consolidateTarget,
      'consolidateTarget',
      warnings,
    ),
    confirmBeforeCommit: coerceBool(
      input.confirmBeforeCommit,
      d.confirmBeforeCommit,
      'confirmBeforeCommit',
      warnings,
    ),
    debugLogging: coerceBool(
      input.debugLogging,
      d.debugLogging,
      'debugLogging',
      warnings,
    ),
  };

  for (const k of Object.keys(input)) {
    if (!TOP_LEVEL_KEYS.has(k as keyof Settings)) {
      warnings.push(`${k}: unknown setting, ignored`);
    }
  }
  if (isPlainObject(input.normalize)) {
    for (const k of Object.keys(input.normalize)) {
      if (!NORMALIZE_KEYS.has(k as keyof Settings['normalize'])) {
        warnings.push(`normalize.${k}: unknown setting, ignored`);
      }
    }
  }

  return { settings, warnings };
}

/** Serialize settings to pretty JSON for export. */
export function settingsToJson(settings: Settings): string {
  return JSON.stringify(settings, null, 2);
}
