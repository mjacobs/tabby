// Default tracking-param blocklist used during URL normalization.
// Patterns support a trailing `*` glob (e.g. `utm_*` matches `utm_source`).

export const DEFAULT_TRACKING_PARAMS: string[] = [
  'utm_*',
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'msclkid',
  'mc_*',
  'ref',
  'ref_src',
  'igshid',
  'vero_*',
  '_hsenc',
  '_hsmi',
];

/** Returns true if `name` matches any blocklist pattern (case-insensitive). */
export function matchesTrackingParam(
  name: string,
  patterns: string[],
): boolean {
  const lower = name.toLowerCase();
  return patterns.some((pattern) => {
    const p = pattern.toLowerCase();
    if (p.endsWith('*')) return lower.startsWith(p.slice(0, -1));
    return lower === p;
  });
}
