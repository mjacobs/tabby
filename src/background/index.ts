// Background service worker (MV3) entry point. Wires the triggers to the
// cleanup pipeline and registers the view message handlers.

import { registerMessageHandlers } from '@/background/messageHandlers';
import { runCleanup } from '@/background/orchestrator';

chrome.action.onClicked.addListener((tab) => {
  void runCleanup({ windowId: tab.windowId });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'run-cleanup') return;
  const win = await chrome.windows.getLastFocused();
  void runCleanup({ windowId: win.id });
});

registerMessageHandlers();
