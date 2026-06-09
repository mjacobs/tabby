// Opt-in navigation trace mode (e6f0).
//
// When Settings.traceNavigation is on, we listen to
// chrome.webNavigation.onCommitted for main-frame commits and append 'nav'
// records (from-URL, to-URL, transition type/qualifiers). The log is later
// harvested to build the stranded-auth URL pattern set (signal 1).
//
// We track each tab's last known main-frame URL in memory so a 'nav' record can
// carry where the tab came from (empty string when unknown — e.g. first commit
// after a worker restart). We skip our own extension's pages so the trace stays
// focused on real web navigation.

import { appendRecords } from '@/background/records';
import type { RecordEntry } from '@/shared/messages';

/** Per-tab last known main-frame URL, used to fill a 'nav' record's fromUrl. */
const lastUrlByTab = new Map<number, string>();

/**
 * Build a 'nav' record from a committed main-frame navigation and the tab's
 * previously known URL. PURE — no chrome.* — so the formatting is unit-testable.
 */
export function buildNavRecord(
  details: {
    tabId: number;
    url: string;
    transitionType: string;
    transitionQualifiers: string[];
  },
  fromUrl: string,
  at: number,
): RecordEntry {
  return {
    at,
    kind: 'nav',
    tabId: details.tabId,
    fromUrl,
    toUrl: details.url,
    transitionType: details.transitionType,
    qualifiers: details.transitionQualifiers,
  };
}

/** True for this extension's own pages (review/options), which we don't trace. */
function isOwnExtensionUrl(url: string): boolean {
  return url.startsWith(`chrome-extension://${chrome.runtime.id}/`);
}

async function onCommitted(
  details: chrome.webNavigation.WebNavigationTransitionCallbackDetails,
): Promise<void> {
  // Main frame only — sub-frame commits are noise for auth-pattern harvesting.
  if (details.frameId !== 0) return;
  if (isOwnExtensionUrl(details.url)) return;

  const fromUrl = lastUrlByTab.get(details.tabId) ?? '';
  lastUrlByTab.set(details.tabId, details.url);

  await appendRecords([
    buildNavRecord(
      {
        tabId: details.tabId,
        url: details.url,
        transitionType: details.transitionType,
        transitionQualifiers: details.transitionQualifiers,
      },
      fromUrl,
      Date.now(),
    ),
  ]);
}

const listener = (
  details: chrome.webNavigation.WebNavigationTransitionCallbackDetails,
): void => {
  void onCommitted(details);
};

/** Drop a closed tab's tracked URL so the map doesn't grow unbounded. */
const removedListener = (tabId: number): void => {
  lastUrlByTab.delete(tabId);
};

let attached = false;

/** Attach the webNavigation listener (idempotent). */
export function enableTrace(): void {
  if (attached) return;
  chrome.webNavigation.onCommitted.addListener(listener);
  chrome.tabs.onRemoved.addListener(removedListener);
  attached = true;
}

/** Detach the listener and forget tracked URLs (idempotent). */
export function disableTrace(): void {
  if (!attached) return;
  chrome.webNavigation.onCommitted.removeListener(listener);
  chrome.tabs.onRemoved.removeListener(removedListener);
  lastUrlByTab.clear();
  attached = false;
}

/** Attach or detach to match the desired enabled state. */
export function setTraceEnabled(enabled: boolean): void {
  if (enabled) enableTrace();
  else disableTrace();
}
