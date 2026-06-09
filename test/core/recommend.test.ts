import { describe, expect, it } from 'vitest';

import { isStrandedAuthUrl, recommendClosures } from '@/core/recommend';
import { normalizeUrl } from '@/core/normalizeUrl';
import { settings, tab } from '../helpers';

const normalize = settings({ normalize: { ignoreWww: true } }).normalize;

describe('isStrandedAuthUrl', () => {
  // Positives drawn from the real OneTab-export evidence in
  // docs/close-recommendation-design.md.
  it.each([
    'https://accounts.google.com/v3/signin/challenge/pwd?TL=abc',
    'https://accounts.google.com/signin/v2/identifier',
    'https://accounts.google.com/ServiceLogin?continue=https://mail.google.com',
    'https://www.chase.com/logout',
    'https://app.infisical.example.com/login',
    'https://login.brev.nvidia.com/signin?returnTo=%2Forg',
    'https://secure.newegg.com/identity/Authentication?nextpage=x',
    'http://localhost:3001/auth?redirect=%2Fdashboard',
    'https://example.com/users/sign_in',
    'https://bank.example.com/session-expired',
    'https://auth.openai.com/authorize-stub/login',
  ])('flags %s', (url) => {
    expect(isStrandedAuthUrl(url)).toBe(true);
  });

  it.each([
    'https://app.example.com/dashboard',
    'https://github.com/torvalds/linux',
    'https://example.com/blog/designing-login-pages',
    // bare /auth with no bounce-back param: too ambiguous (dev/API routes)
    'http://localhost:3001/auth',
    // OAuth consent mid-flow, not a stranded landing
    'https://example.com/oauth/authorize',
    // non-http schemes never flagged
    'chrome://settings',
    'about:blank',
    'not a url',
  ])('does not flag %s', (url) => {
    expect(isStrandedAuthUrl(url)).toBe(false);
  });
});

describe('recommendClosures', () => {
  const bookmarked = (...urls: string[]) =>
    new Set(urls.map((u) => normalizeUrl(u, normalize).normalized));

  it('flags bookmarked tabs by exact normalized URL match', () => {
    const t1 = tab({ url: 'https://example.com/article?utm_source=x' });
    const t2 = tab({ url: 'https://example.com/other' });
    const recs = recommendClosures([t1, t2], {
      bookmarkedUrls: bookmarked('https://www.example.com/article'),
      normalize,
    });
    expect(recs).toEqual([{ tabId: t1.id, reasons: ['bookmarked'] }]);
  });

  it('flags stranded-auth tabs with their reason', () => {
    const t = tab({ url: 'https://www.chase.com/logout' });
    const recs = recommendClosures([t], {
      bookmarkedUrls: new Set(),
      normalize,
    });
    expect(recs).toEqual([{ tabId: t.id, reasons: ['stranded-auth'] }]);
  });

  it('stacks independent reasons on one tab', () => {
    const url = 'https://accounts.google.com/v3/signin/challenge/pwd';
    const t = tab({ url });
    const recs = recommendClosures([t], {
      bookmarkedUrls: bookmarked(url),
      normalize,
    });
    expect(recs).toEqual([
      { tabId: t.id, reasons: ['bookmarked', 'stranded-auth'] },
    ]);
  });

  it('never flags the active or pinned tab', () => {
    const url = 'https://www.chase.com/logout';
    const active = tab({ url, active: true });
    const pinned = tab({ url, pinned: true });
    const plain = tab({ url });
    const recs = recommendClosures([active, pinned, plain], {
      bookmarkedUrls: bookmarked(url),
      normalize,
    });
    expect(recs).toEqual([
      { tabId: plain.id, reasons: ['bookmarked', 'stranded-auth'] },
    ]);
  });

  it('per-signal toggles suppress only their own flag (kata 2gga)', () => {
    const url = 'https://accounts.google.com/v3/signin/challenge/pwd';
    const t = tab({ url });
    const ctx = { bookmarkedUrls: bookmarked(url), normalize };
    expect(
      recommendClosures([t], {
        ...ctx,
        options: { bookmarked: false, strandedAuth: true, excludedDomains: [] },
      }),
    ).toEqual([{ tabId: t.id, reasons: ['stranded-auth'] }]);
    expect(
      recommendClosures([t], {
        ...ctx,
        options: { bookmarked: true, strandedAuth: false, excludedDomains: [] },
      }),
    ).toEqual([{ tabId: t.id, reasons: ['bookmarked'] }]);
  });

  it('excluded domains are never flagged, including subdomains (kata 2gga)', () => {
    const t1 = tab({ url: 'https://login.brev.nvidia.com/signin' });
    const t2 = tab({ url: 'https://www.chase.com/logout' });
    const recs = recommendClosures([t1, t2], {
      bookmarkedUrls: new Set(),
      normalize,
      options: {
        bookmarked: true,
        strandedAuth: true,
        excludedDomains: ['nvidia.com'],
      },
    });
    expect(recs).toEqual([{ tabId: t2.id, reasons: ['stranded-auth'] }]);
  });

  it('returns nothing when no signal applies', () => {
    const recs = recommendClosures(
      [tab({ url: 'https://example.com/work' })],
      { bookmarkedUrls: new Set(), normalize },
    );
    expect(recs).toEqual([]);
  });
});
