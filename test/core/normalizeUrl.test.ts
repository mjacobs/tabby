import { describe, expect, it } from 'vitest';

import { normalizeUrl } from '@/core/normalizeUrl';
import { DEFAULT_SETTINGS } from '@/shared/settings';

const opts = DEFAULT_SETTINGS.normalize;

describe('normalizeUrl', () => {
  it('drops the fragment', () => {
    expect(normalizeUrl('https://ex.com/p#section', opts).normalized).toBe(
      'https://ex.com/p',
    );
  });

  it('strips tracking params but keeps real ones', () => {
    expect(
      normalizeUrl('https://ex.com/p?utm_source=x&id=7&fbclid=abc', opts)
        .normalized,
    ).toBe('https://ex.com/p?id=7');
  });

  it('drops a trailing slash but preserves root', () => {
    expect(normalizeUrl('https://ex.com/p/', opts).normalized).toBe(
      'https://ex.com/p',
    );
    expect(normalizeUrl('https://ex.com/', opts).normalized).toBe(
      'https://ex.com/',
    );
  });

  it('collapses tracking/fragment/slash variants to one value', () => {
    const a = normalizeUrl('https://ex.com/p?utm_source=x', opts).normalized;
    const b = normalizeUrl('https://ex.com/p', opts).normalized;
    const c = normalizeUrl('https://ex.com/p#here', opts).normalized;
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('is order-insensitive for kept query params', () => {
    const a = normalizeUrl('https://ex.com/p?b=2&a=1', opts).normalized;
    const b = normalizeUrl('https://ex.com/p?a=1&b=2', opts).normalized;
    expect(a).toBe(b);
  });

  it('leaves non-http(s) URLs untouched', () => {
    expect(normalizeUrl('chrome://extensions', opts).normalized).toBe(
      'chrome://extensions',
    );
  });

  it('folds www. only when ignoreWww is enabled', () => {
    expect(normalizeUrl('https://www.ex.com/p', opts).normalized).toBe(
      'https://www.ex.com/p',
    );
    const folded = normalizeUrl('https://www.ex.com/p', {
      ...opts,
      ignoreWww: true,
    }).normalized;
    expect(folded).toBe('https://ex.com/p');
  });
});
