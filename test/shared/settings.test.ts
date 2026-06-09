import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SETTINGS,
  coerceSettings,
  settingsToJson,
} from '@/shared/settings';

describe('coerceSettings', () => {
  it('round-trips a valid exported settings object unchanged', () => {
    const custom = {
      ...DEFAULT_SETTINGS,
      keepPolicy: 'oldest' as const,
      protectAudible: true,
      blankTabPolicy: 'protect' as const,
      consolidateTarget: 'new-window' as const,
      normalize: {
        ...DEFAULT_SETTINGS.normalize,
        ignoreWww: true,
        trackingParams: ['utm_*', 'fbclid'],
      },
    };
    const parsed = JSON.parse(settingsToJson(custom));
    const { settings, warnings } = coerceSettings(parsed);
    expect(settings).toEqual(custom);
    expect(warnings).toEqual([]);
  });

  it('fills missing fields from defaults and merges partial input', () => {
    const { settings, warnings } = coerceSettings({ keepPolicy: 'leftmost' });
    expect(settings.keepPolicy).toBe('leftmost');
    // everything else falls back to defaults
    expect(settings.protectPinned).toBe(DEFAULT_SETTINGS.protectPinned);
    expect(settings.normalize).toEqual(DEFAULT_SETTINGS.normalize);
    expect(warnings).toEqual([]);
  });

  it('coerces wrong-typed fields to defaults with a warning', () => {
    const { settings, warnings } = coerceSettings({
      protectPinned: 'yes',
      keepPolicy: 'bogus',
      normalize: { dropFragment: 1, trackingParams: 'utm' },
    });
    expect(settings.protectPinned).toBe(DEFAULT_SETTINGS.protectPinned);
    expect(settings.keepPolicy).toBe(DEFAULT_SETTINGS.keepPolicy);
    expect(settings.normalize.dropFragment).toBe(
      DEFAULT_SETTINGS.normalize.dropFragment,
    );
    expect(settings.normalize.trackingParams).toEqual(
      DEFAULT_SETTINGS.normalize.trackingParams,
    );
    expect(warnings).toEqual(
      expect.arrayContaining([
        'protectPinned: expected boolean, kept default',
        'keepPolicy: invalid value, kept default',
        'normalize.dropFragment: expected boolean, kept default',
        'normalize.trackingParams: expected string[], kept default',
      ]),
    );
  });

  it('ignores unknown keys but warns', () => {
    const { settings, warnings } = coerceSettings({
      keepPolicy: 'oldest',
      bogusTop: 1,
      normalize: { unknownNorm: true },
    });
    expect(settings.keepPolicy).toBe('oldest');
    expect(settings).not.toHaveProperty('bogusTop');
    expect(warnings).toEqual(
      expect.arrayContaining([
        'bogusTop: unknown setting, ignored',
        'normalize.unknownNorm: unknown setting, ignored',
      ]),
    );
  });

  it('coerces the recommend block field by field (kata 2gga)', () => {
    const { settings, warnings } = coerceSettings({
      recommend: {
        bookmarked: false,
        strandedAuth: 'nope',
        excludedDomains: ['chase.com'],
        bogus: 1,
      },
    });
    expect(settings.recommend.bookmarked).toBe(false);
    expect(settings.recommend.strandedAuth).toBe(
      DEFAULT_SETTINGS.recommend.strandedAuth,
    );
    expect(settings.recommend.excludedDomains).toEqual(['chase.com']);
    expect(warnings).toEqual(
      expect.arrayContaining([
        'recommend.strandedAuth: expected boolean, kept default',
        'recommend.bogus: unknown setting, ignored',
      ]),
    );
  });

  it('returns defaults for non-object input', () => {
    for (const bad of [null, 42, 'x', [1, 2], undefined]) {
      const { settings, warnings } = coerceSettings(bad);
      expect(settings).toEqual(DEFAULT_SETTINGS);
      expect(warnings).toContain('root: not an object, using defaults');
    }
  });
});
