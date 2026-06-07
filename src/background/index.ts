// Background service worker (MV3).
//
// Phase 0: just opens the review page on trigger so the extension is loadable
// and the wiring is verifiable. The consolidate → dedup → sort orchestration
// lands in Phase 2 (see PLAN.md).

const REVIEW_PAGE = 'src/review/review.html';

async function openReview(): Promise<void> {
  const url = chrome.runtime.getURL(REVIEW_PAGE);

  // Reuse an existing Tabby review tab if one is already open.
  const [existing] = await chrome.tabs.query({ url });
  if (existing?.id != null) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId != null) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return;
  }

  await chrome.tabs.create({ url });
}

chrome.action.onClicked.addListener(() => {
  void openReview();
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'run-cleanup') {
    void openReview();
  }
});
