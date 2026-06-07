// The view's only link to the outside world. ReviewView depends on this
// interface, never on chrome.* directly, so the same component can mount in a
// page (chromeTransport) or a test (fake transport) or a future side panel.

import { sendRequest, type ReviewState } from '@/shared/messages';

export interface ReviewTransport {
  getReview(): Promise<ReviewState | null>;
  jumpTo(tabId: number): Promise<void>;
  /** Close the given tabs; returns how many were closed. */
  commitClose(tabIds: number[]): Promise<number>;
  /** Restore the last closed batch; returns how many reopened. */
  undo(): Promise<number>;
  closeEmptyWindows(windowIds: number[]): Promise<number>;
  /** Subscribe to tabs closed outside the review; returns an unsubscribe fn. */
  onTabRemoved(cb: (tabId: number) => void): () => void;
  /** Subscribe to tab title/url changes; returns an unsubscribe fn. */
  onTabUpdated(
    cb: (tabId: number, title?: string, url?: string) => void,
  ): () => void;
}

/** The real transport, backed by runtime messaging + chrome.tabs events. */
export const chromeTransport: ReviewTransport = {
  getReview: () => sendRequest({ type: 'getReview' }),
  async jumpTo(tabId) {
    await sendRequest({ type: 'jumpTo', tabId });
  },
  async commitClose(tabIds) {
    return (await sendRequest({ type: 'commitClose', tabIds })).closed;
  },
  async undo() {
    return (await sendRequest({ type: 'undo' })).restored;
  },
  async closeEmptyWindows(windowIds) {
    return (await sendRequest({ type: 'closeEmptyWindows', windowIds })).closed;
  },
  onTabRemoved(cb) {
    const handler = (tabId: number) => cb(tabId);
    chrome.tabs.onRemoved.addListener(handler);
    return () => chrome.tabs.onRemoved.removeListener(handler);
  },
  onTabUpdated(cb) {
    const handler = (tabId: number, info: { title?: string; url?: string }) =>
      cb(tabId, info.title, info.url);
    chrome.tabs.onUpdated.addListener(handler);
    return () => chrome.tabs.onUpdated.removeListener(handler);
  },
};
