// The view's only link to the outside world. ReviewView depends on this
// interface, never on chrome.* directly, so the same component can mount in a
// page (chromeTransport) or a test (fake transport) or a future side panel.

import {
  sendRequest,
  type ReviewState,
  type WorkerBroadcast,
} from '@/shared/messages';
import { tabInfoFromChromeTab } from '@/shared/tabs';
import type { Settings, TabInfo } from '@/shared/types';
import type { Recommendation } from '@/core/recommend';

export interface ReviewTransport {
  getReview(): Promise<ReviewState | null>;
  /** Current settings (for live re-sorting of the review list). */
  getSettings(): Promise<Settings>;
  /** Live tabs of a window, excluding Tabby's own review page. */
  queryTabs(windowId: number): Promise<TabInfo[]>;
  jumpTo(tabId: number): Promise<void>;
  /** Close the given tabs; returns how many were closed. */
  commitClose(tabIds: number[]): Promise<number>;
  /** Advisory close-recommendation flags for the given tabs (kata 9kb5). */
  getRecommendations(tabs: TabInfo[]): Promise<Recommendation[]>;
  /** Restore the last closed batch; returns how many reopened. */
  undo(): Promise<number>;
  closeEmptyWindows(windowIds: number[]): Promise<number>;
  /**
   * Subscribe to any change in the window's tab structure (created, removed,
   * moved, attached/detached, updated, group changes). The callback gets no
   * detail — the view reconciles by re-querying live state. Returns unsubscribe.
   */
  onTabsChanged(cb: () => void): () => void;
  /** Subscribe to worker "review re-stashed" broadcasts; returns an unsubscribe fn. */
  onReviewUpdated(cb: () => void): () => void;
}

/** The real transport, backed by runtime messaging + chrome.tabs events. */
export const chromeTransport: ReviewTransport = {
  getReview: () => sendRequest({ type: 'getReview' }),
  async getSettings() {
    return (await sendRequest({ type: 'exportSettings' })).settings;
  },
  async queryTabs(windowId) {
    const extensionPrefix = `chrome-extension://${chrome.runtime.id}/`;
    const tabs = await chrome.tabs.query({ windowId });
    return tabs
      .filter((t) => t.id != null && (!t.url || !t.url.startsWith(extensionPrefix)))
      .map(tabInfoFromChromeTab);
  },
  async jumpTo(tabId) {
    await sendRequest({ type: 'jumpTo', tabId });
  },
  async commitClose(tabIds) {
    return (await sendRequest({ type: 'commitClose', tabIds })).closed;
  },
  async getRecommendations(tabs) {
    return (await sendRequest({ type: 'getRecommendations', tabs }))
      .recommendations;
  },
  async undo() {
    return (await sendRequest({ type: 'undo' })).restored;
  },
  async closeEmptyWindows(windowIds) {
    return (await sendRequest({ type: 'closeEmptyWindows', windowIds })).closed;
  },
  onTabsChanged(cb) {
    const fire = () => cb();
    // Tab lifecycle/structure events that can change what the window contains.
    chrome.tabs.onCreated.addListener(fire);
    chrome.tabs.onRemoved.addListener(fire);
    chrome.tabs.onUpdated.addListener(fire);
    chrome.tabs.onMoved.addListener(fire);
    chrome.tabs.onAttached.addListener(fire);
    chrome.tabs.onDetached.addListener(fire);
    // Group changes (pin/unpin surfaces through onUpdated; grouping through these).
    chrome.tabGroups?.onUpdated.addListener(fire);
    chrome.tabGroups?.onMoved.addListener(fire);
    chrome.tabGroups?.onRemoved.addListener(fire);
    return () => {
      chrome.tabs.onCreated.removeListener(fire);
      chrome.tabs.onRemoved.removeListener(fire);
      chrome.tabs.onUpdated.removeListener(fire);
      chrome.tabs.onMoved.removeListener(fire);
      chrome.tabs.onAttached.removeListener(fire);
      chrome.tabs.onDetached.removeListener(fire);
      chrome.tabGroups?.onUpdated.removeListener(fire);
      chrome.tabGroups?.onMoved.removeListener(fire);
      chrome.tabGroups?.onRemoved.removeListener(fire);
    };
  },
  onReviewUpdated(cb) {
    const handler = (msg: WorkerBroadcast) => {
      if (msg?.type === 'reviewUpdated') cb();
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  },
};
