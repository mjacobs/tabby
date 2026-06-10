// Background service worker (MV3) entry point. Wires the triggers to the
// cleanup pipeline and registers the view message handlers.

import { registerMessageHandlers } from '@/background/messageHandlers';
import { runCleanup } from '@/background/orchestrator';
import { setTraceEnabled } from '@/background/trace';
import { loadSettings } from '@/shared/settings';
import type { Settings } from '@/shared/types';

chrome.action.onClicked.addListener((tab) => {
  void runCleanup({ windowId: tab.windowId });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'run-cleanup') return;
  const win = await chrome.windows.getLastFocused();
  void runCleanup({ windowId: win.id });
});

registerMessageHandlers();

// Navigation trace mode (e6f0): attach/detach the webNavigation listener to
// match Settings.traceNavigation. Read once at worker start, then react to
// settings changes (settings live in chrome.storage.sync).
async function initTrace(): Promise<void> {
  const settings = await loadSettings();
  setTraceEnabled(settings.traceNavigation);
}
void initTrace();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.settings) return;
  const next = changes.settings.newValue as Partial<Settings> | undefined;
  setTraceEnabled(next?.traceNavigation ?? false);
});
