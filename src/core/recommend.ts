// Pure close-recommendation logic (kata 9kb5) — no Chrome APIs.
//
// Tabby flags tabs as *candidates for closure* with an explicit reason; it
// recommends, the user decides. Signals are independent flags, never a blended
// score, and precision is favored over recall: a noisy recommender trains the
// user to ignore it (docs/close-recommendation-design.md).

import type { Settings, TabInfo } from '@/shared/types';
import { normalizeUrl } from '@/core/normalizeUrl';

/** Why a tab is recommended for closure. Each flag carries its own reason. */
export type RecommendReason = 'bookmarked' | 'stranded-auth';

/** One flagged tab with all the reasons that apply to it. */
export interface Recommendation {
  tabId: number;
  reasons: RecommendReason[];
}

type NormalizeOptions = Settings['normalize'];

// --- Stranded-auth matcher -------------------------------------------------
//
// "Session timed out" is not observable from local state, but its symptom is:
// the tab got bounced to a login/challenge URL. v1 is a static match on the
// tab's current URL. The seed set below comes from real OneTab-export evidence
// (see the design doc); it will be refined from the records/trace harvest
// (kata e6f0), so patterns are data, not branching code.

/** Final path segments that unambiguously mean "this page is a login/logout". */
const AUTH_PATH_SEGMENTS = new Set([
  'login',
  'log-in',
  'log_in',
  'signin',
  'sign-in',
  'sign_in',
  'logout',
  'log-out',
  'log_out',
  'signout',
  'sign-out',
  'sign_out',
  'authentication',
  'sessionexpired',
  'session-expired',
]);

/**
 * A bare `/auth` segment is ambiguous (dev servers, API routes) and only
 * counts when paired with a bounce-back query param — the stranded shape is
 * "redirected here, with a pointer back to where you were".
 */
const REDIRECT_PARAMS = [
  'redirect',
  'redirect_uri',
  'redirect_url',
  'returnurl',
  'return_url',
  'return_to',
  'returnto',
  'next',
  'continue',
  'goto',
];

/** Hostnames whose first label marks a dedicated auth host. */
const AUTH_HOST_PREFIXES = ['login.', 'signin.', 'auth.'];

/** Host-specific patterns that the generic rules miss. */
const AUTH_HOST_PATHS: Array<{ host: string; pathPrefixes: string[] }> = [
  {
    host: 'accounts.google.com',
    // Covers /signin/*, /v3/signin/*, /v3/signin/challenge/*, /ServiceLogin.
    pathPrefixes: ['/signin', '/v3/signin', '/servicelogin', '/accountchooser'],
  },
];

/**
 * True when `rawUrl` looks like a login/challenge/logout page a session
 * timeout would strand a tab on. Conservative by design.
 */
export function isStrandedAuthUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  for (const { host: h, pathPrefixes } of AUTH_HOST_PATHS) {
    if (host === h && pathPrefixes.some((p) => path.startsWith(p))) {
      return true;
    }
  }

  if (AUTH_HOST_PREFIXES.some((p) => host.startsWith(p))) return true;

  const segments = path.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? '';
  if (AUTH_PATH_SEGMENTS.has(last)) return true;

  if (last === 'auth') {
    for (const param of REDIRECT_PARAMS) {
      if (url.searchParams.has(param)) return true;
    }
  }

  return false;
}

// --- Recommendation assembly -------------------------------------------------

export interface RecommendContext {
  /** Normalized URLs of all bookmarks (same normalize options applied). */
  bookmarkedUrls: ReadonlySet<string>;
  normalize: NormalizeOptions;
}

/**
 * Compute advisory close flags for the given tabs.
 *
 * The active tab is never flagged: it is what the user is looking at right
 * now (a login page they are mid-flow on, or a bookmarked page in use), so
 * recommending its closure is noise. Pinned tabs are likewise skipped — the
 * user explicitly anchored them.
 */
export function recommendClosures(
  tabs: TabInfo[],
  ctx: RecommendContext,
): Recommendation[] {
  const out: Recommendation[] = [];
  for (const tab of tabs) {
    if (tab.active || tab.pinned) continue;
    const reasons: RecommendReason[] = [];
    const { normalized } = normalizeUrl(tab.url, ctx.normalize);
    if (ctx.bookmarkedUrls.has(normalized)) reasons.push('bookmarked');
    if (isStrandedAuthUrl(tab.url)) reasons.push('stranded-auth');
    if (reasons.length > 0) out.push({ tabId: tab.id, reasons });
  }
  return out;
}
