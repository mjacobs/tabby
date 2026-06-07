// Background service worker (MV3) entry point. Wires the triggers to the
// cleanup pipeline and registers the view message handlers.

import { registerMessageHandlers } from '@/background/messageHandlers';
import { runCleanup } from '@/background/orchestrator';

chrome.action.onClicked.addListener(() => {
  void runCleanup();
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'run-cleanup') {
    void runCleanup();
  }
});

registerMessageHandlers();
