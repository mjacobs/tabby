// Pure URL classification — no Chrome APIs.
//
// Splits URLs into distinct categories so each can have its own cleanup policy,
// instead of lumping every non-web URL into one "special" bucket. This lets us
// (e.g.) purge blank tabs while still protecting browser/extension pages.

export type UrlCategory =
  | 'web' // http(s) pages — the normal case
  | 'blank' // about:blank, new-tab pages, empty URL
  | 'browser' // chrome://, about:, edge://, view-source:, devtools:, …
  | 'extension' // chrome-extension://, moz-extension://
  | 'file' // file://
  | 'other'; // anything unrecognized / unparseable

const BLANK_EXACT = new Set(['', 'about:blank', 'about:newtab', 'about:home']);

// New-tab pages count as blank for cleanup purposes (empty, disposable).
const NEWTAB_PREFIXES = [
  'chrome://newtab',
  'chrome://new-tab-page',
  'chrome-search://local-ntp',
  'edge://newtab',
  'brave://newtab',
];

export function classifyUrl(rawUrl: string): UrlCategory {
  const url = rawUrl.trim();
  if (BLANK_EXACT.has(url)) return 'blank';

  const lower = url.toLowerCase();
  if (NEWTAB_PREFIXES.some((prefix) => lower.startsWith(prefix))) return 'blank';

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'other';
  }

  switch (parsed.protocol) {
    case 'http:':
    case 'https:':
      return 'web';
    case 'file:':
      return 'file';
    case 'chrome-extension:':
    case 'moz-extension:':
      return 'extension';
    case 'chrome:':
    case 'chrome-search:':
    case 'about:':
    case 'edge:':
    case 'brave:':
    case 'devtools:':
    case 'view-source:':
      return 'browser';
    default:
      return 'other';
  }
}
