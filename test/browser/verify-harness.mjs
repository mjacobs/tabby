// Browser verification harness (Chrome-in-the-loop, agent-driven).
//
// These scenarios verify behaviour that unit tests with chrome.* fakes can miss
// (group ejection on cross-window consolidation, virtualization spacer math,
// real dedup of chrome:// tabs, side-panel asset loading). They are NOT vitest
// tests — they require a LIVE Chrome with the unpacked extension loaded, driven
// over the Chrome DevTools Protocol via the `chrome-devtools-mcp` server.
//
// Each exported function is a self-contained `async () => {...}` whose BODY is
// injected verbatim into an extension page through the MCP `evaluate_script`
// tool. They return a structured `{ ...fields, pass }` object — never throw —
// so a harness can collect pass/fail without exception handling. They use only
// `chrome.*` (available because they run inside an extension page) and the
// extension's own control-surface messages (runCleanup / dumpState / getReview /
// getRecommendations / importSettings / getRecords — see src/background/
// messageHandlers.ts), so the whole set-config -> stage -> trigger -> observe
// loop runs with zero UI clicks.
//
// SETUP (one-time): see ./README.md. In short:
//   1. pnpm build            (rebuild dist/ from main)
//   2. Project .mcp.json runs chrome-devtools-mcp with:
//        --categoryExtensions
//        --ignoreDefaultChromeArg=--disable-extensions
//      (the default launch passes --disable-extensions, which hides the
//      extension; --load-extension is gated on Chrome 137+ so we install at
//      runtime instead — step 3.)
//   3. MCP tool `install_extension({ path: "<abs>/dist" })`  -> id
//      adgplbcmppgollmecedoilcppifiahih (pinned by manifest.config.ts `key`).
//   4. Open an extension page as the scripting host:
//        new_page("chrome-extension://<id>/src/options/options.html")
//      Run logic/state scenarios there. For the UI scenarios, runCleanup opens
//      the review page; `select_page` it before injecting the DOM scenario.
//
// RESULTS (verified 2026-06-13 on Chrome 149, extension id adgplbcmppgollmecedoilcppifiahih):
//   hz3t pass x4 | 1d8m pass | swbr pass | 0awf pass | 3ndp/k3jc/2gga pass |
//   e6f0 pass | 49m8/yrez pass | mvzz pass (206 items -> 27 rendered) | b08q pass.

// --- Shared helpers (inline these into each scenario; evaluate_script injects a
//     single function, so scenarios cannot import across calls) ---------------

export const HELPERS = `
  const optionsUrl = chrome.runtime.getURL('src/options/options.html');
  const send = (msg) => chrome.runtime.sendMessage(msg);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const optionsTabId = async () => {
    const tabs = await chrome.tabs.query({});
    const t = tabs.find(t => t.url && t.url.startsWith(optionsUrl));
    return t ? t.id : null;
  };
  const resetToOptionsOnly = async () => {
    const keep = await optionsTabId();
    const tabs = await chrome.tabs.query({});
    const toClose = tabs.filter(t => t.id !== keep).map(t => t.id);
    if (toClose.length) { try { await chrome.tabs.remove(toClose); } catch (e) {} }
    await sleep(150);
  };
  const waitCommitted = async (ids, ms = 6000) => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const tabs = await Promise.all(ids.map(id => chrome.tabs.get(id).catch(() => null)));
      if (tabs.every(t => t && t.url && /^https?:/.test(t.url))) return true;
      await sleep(200);
    }
    return false;
  };
`;

// --- hz3t: within-group URL sort without group ejection ----------------------
// Highest-value item: the failure mode (a member ejected from its group on
// cross-window consolidation) is exactly what chrome.* fakes historically
// missed. Stages an out-of-order group (/c,/a,/b), runs cleanup, asserts via
// dumpState that the group ends URL-sorted, contiguous, one groupId, one window.
// Run all four variants: in-place, collapsed, cross-window, cross-window+collapsed.
export async function hz3t_groupSortNoEjection() {
  const order = ['c', 'a', 'b'];
  const runVariant = async (name, newWindow, collapsed) => {
    await resetToOptionsOnly();
    let windowId, ids = [];
    if (newWindow) {
      const w = await chrome.windows.create({ url: `https://example.com/${order[0]}` });
      windowId = w.id; ids.push(w.tabs[0].id);
      for (let i = 1; i < order.length; i++)
        ids.push((await chrome.tabs.create({ windowId, url: `https://example.com/${order[i]}`, active: false })).id);
      const opt = await chrome.tabs.get(await optionsTabId());
      await chrome.windows.update(opt.windowId, { focused: true });
    } else {
      const opt = await chrome.tabs.get(await optionsTabId());
      windowId = opt.windowId;
      for (const seg of order)
        ids.push((await chrome.tabs.create({ windowId, url: `https://example.com/${seg}`, active: false })).id);
    }
    const committed = await waitCommitted(ids);
    const groupId = await chrome.tabs.group({ tabIds: ids, createProperties: { windowId } });
    await chrome.tabGroups.update(groupId, { title: name, collapsed });
    await sleep(200);
    const res = await send({ type: 'runCleanup' });
    await sleep(500);
    const dump = await send({ type: 'dumpState' });
    const all = dump.current.windows.flatMap(w => w.tabs.map(t => ({ ...t, win: w.id })));
    const g = all.filter(t => /example\.com\//.test(t.urlRaw));
    const oneGroup = new Set(g.map(t => t.groupId)).size === 1 && g.every(t => t.groupId != null && t.groupId !== -1);
    const byIndex = [...g].sort((a, b) => a.index - b.index);
    const urls = byIndex.map(t => t.urlNormalized);
    const isSorted = JSON.stringify(urls) === JSON.stringify([...urls].sort());
    const contiguous = byIndex.map(t => t.index).every((v, i, a) => i === 0 || v === a[i - 1] + 1);
    const sameWindow = new Set(byIndex.map(t => t.win)).size === 1;
    return { variant: name, committed, foundGroupTabs: g.length, oneGroup, isSorted, urls, contiguous, sameWindow,
      pass: committed && g.length === 3 && oneGroup && isSorted && contiguous && sameWindow };
  };
  const results = [
    await runVariant('basic', false, false),
    await runVariant('collapsed', false, true),
    await runVariant('crosswindow', true, false),
    await runVariant('crosswindow-collapsed', true, true),
  ];
  await resetToOptionsOnly();
  return results;
}

// --- 1d8m: Tabby's own tabs never appear as rows; run-twice reuses one tab ----
export async function d1d8m_selfExclusion() {
  const reviewBase = chrome.runtime.getURL('src/review/review.html');
  await resetToOptionsOnly();
  await chrome.tabs.create({ url: 'https://example.com/keep', active: false });
  await chrome.tabs.create({ url: reviewBase + '#frag', active: false }); // #hash review tab
  await sleep(1500);
  await send({ type: 'runCleanup' }); await sleep(500);
  await send({ type: 'runCleanup' }); await sleep(500);
  const review = await send({ type: 'getReview' });
  const allTabs = await chrome.tabs.query({});
  const rowUrls = (review?.reviewTabs || []).map(t => t.url);
  const reviewTabCount = allTabs.filter(t => t.url && t.url.startsWith(reviewBase)).length;
  await resetToOptionsOnly();
  return { rowUrls, reviewTabCount,
    pass: !rowUrls.some(u => u && u.startsWith(reviewBase)) && !rowUrls.some(u => u && u.startsWith(optionsUrl))
       && rowUrls.includes('https://example.com/keep') && reviewTabCount === 1 };
}

// --- swbr + 0awf: dedup (incl chrome://) + no phantom empty-window ids --------
export async function swbr_0awf_dedupAndEmptyWindows() {
  await resetToOptionsOnly();
  const opt = await chrome.tabs.get(await optionsTabId());
  const winA = opt.windowId;
  await chrome.tabs.create({ windowId: winA, url: 'https://example.com/dup', active: false });
  await chrome.tabs.create({ windowId: winA, url: 'https://example.com/dup', active: false });
  let chromeCreate = 'ok';
  try {
    await chrome.tabs.create({ windowId: winA, url: 'chrome://extensions/', active: false });
    await chrome.tabs.create({ windowId: winA, url: 'chrome://extensions/', active: false });
  } catch (e) { chromeCreate = String(e); }
  const wB = await chrome.windows.create({ url: 'https://example.com/solo' });
  await chrome.windows.update(winA, { focused: true });
  await sleep(2500);
  await send({ type: 'runCleanup' }); await sleep(600);
  const review = await send({ type: 'getReview' });
  const allTabs = await chrome.tabs.query({});
  const dupCount = allTabs.filter(t => t.url === 'https://example.com/dup').length;
  const chromeExtCount = allTabs.filter(t => t.url && t.url.startsWith('chrome://extensions')).length;
  const emptyIds = review?.emptyWindowIds || [];
  const stillOpen = [];
  for (const id of emptyIds) { try { await chrome.windows.get(id); stillOpen.push(id); } catch (e) {} }
  await resetToOptionsOnly();
  return { chromeCreate, dupCount, chromeExtCount, emptyWindowIds: emptyIds, emptyAllStillOpen: emptyIds.length === stillOpen.length,
    pass_swbr: dupCount === 1 && (chromeCreate !== 'ok' || chromeExtCount === 1),
    pass_0awf: emptyIds.length === stillOpen.length };
}

// --- 3ndp / k3jc / 2gga: recommend badges + per-signal toggles ---------------
export async function recommend_badgesAndToggles() {
  const toTabInfo = (t) => ({ id: t.id, windowId: t.windowId, index: t.index, url: t.url, title: t.title || '',
    pinned: !!t.pinned, audible: !!t.audible, active: !!t.active, groupId: t.groupId, lastAccessed: t.lastAccessed });
  await resetToOptionsOnly();
  for (const b of await chrome.bookmarks.search({ url: 'https://example.com/marked' })) { try { await chrome.bookmarks.remove(b.id); } catch (e) {} }
  await chrome.bookmarks.create({ title: 'marked', url: 'https://example.com/marked' });
  const opt = await chrome.tabs.get(await optionsTabId());
  const winA = opt.windowId;
  const mk = async (u) => (await chrome.tabs.create({ windowId: winA, url: u, active: false })).id;
  const idMarked = await mk('https://example.com/marked');
  const idLogin = await mk('https://example.com/login');
  const idPlain = await mk('https://example.com/plain');
  await sleep(2500);
  const staged = (await chrome.tabs.query({ windowId: winA })).filter(t => [idMarked, idLogin, idPlain].includes(t.id)).map(toTabInfo);
  const reasons = (recs, id) => (recs.find(r => r.tabId === id)?.reasons) || [];
  const get = async (recommend) => {
    await send({ type: 'importSettings', settings: { recommend } });
    return (await send({ type: 'getRecommendations', tabs: staged })).recommendations;
  };
  const base = await get({ bookmarked: true, strandedAuth: true, excludedDomains: [] });
  const noBook = await get({ bookmarked: false, strandedAuth: true, excludedDomains: [] });
  const noneOn = await get({ bookmarked: false, strandedAuth: false, excludedDomains: [] });
  const excluded = await get({ bookmarked: true, strandedAuth: true, excludedDomains: ['example.com'] });
  const headings = [...document.querySelectorAll('h1,h2,h3,legend,label,summary')].map(e => e.textContent.trim());
  const hasRecommendSection = headings.some(h => /suggest|recommend|bookmark|stranded|login/i.test(h));
  await send({ type: 'importSettings', settings: {} });
  for (const b of await chrome.bookmarks.search({ url: 'https://example.com/marked' })) { try { await chrome.bookmarks.remove(b.id); } catch (e) {} }
  await resetToOptionsOnly();
  return {
    pass_3ndp: reasons(base, idMarked).includes('bookmarked'),
    pass_k3jc: reasons(base, idLogin).includes('stranded-auth'),
    pass_2gga: !reasons(noBook, idMarked).includes('bookmarked') && reasons(noBook, idLogin).includes('stranded-auth')
            && noneOn.length === 0 && excluded.length === 0 && hasRecommendSection,
  };
}

// --- e6f0: records log accumulates (recommendation + nav + close) ------------
export async function e6f0_recordsAccumulate() {
  const toTabInfo = (t) => ({ id: t.id, windowId: t.windowId, index: t.index, url: t.url, title: t.title || '',
    pinned: !!t.pinned, audible: !!t.audible, active: !!t.active, groupId: t.groupId, lastAccessed: t.lastAccessed });
  await resetToOptionsOnly();
  await send({ type: 'clearRecords' });
  await send({ type: 'importSettings', settings: { traceNavigation: true } }); // storage.onChanged attaches the webNavigation listener live
  await sleep(400);
  const opt = await chrome.tabs.get(await optionsTabId());
  const navTab = await chrome.tabs.create({ windowId: opt.windowId, url: 'https://example.com/login', active: false });
  await sleep(1800);
  await chrome.tabs.update(navTab.id, { url: 'https://example.com/after-login' });
  await sleep(1800);
  const cur = await chrome.tabs.get(navTab.id);
  await send({ type: 'getRecommendations', tabs: [toTabInfo({ ...cur, url: 'https://example.com/login', active: false })] });
  const tmp = await chrome.tabs.create({ windowId: opt.windowId, url: 'https://example.com/closeme', active: false });
  await sleep(800);
  await send({ type: 'commitClose', tabIds: [tmp.id] });
  await sleep(300);
  const recs = (await send({ type: 'getRecords' })).records;
  const direct = (await chrome.storage.local.get('tabby:records'))['tabby:records'] || [];
  await send({ type: 'importSettings', settings: {} });
  await resetToOptionsOnly();
  return { total: recs.length, kinds: [...new Set(recs.map(r => r.kind))], storageKeyMatches: direct.length === recs.length,
    pass: recs.length > 0 && direct.length === recs.length
       && recs.some(r => r.kind === 'recommendation') && recs.some(r => r.kind === 'close') };
}

// --- 49m8 + yrez: badge styling, cursor jump, collapse markers ---------------
// Run AFTER staging a group + a /login + a bookmarked tab and running cleanup,
// with the REVIEW page selected. Drives the live DOM + simulated keys.
export async function yrez_49m8_reviewDom() {
  const tick = () => new Promise(r => requestAnimationFrame(() => r()));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const fireKey = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  let waited = 0;
  while (waited < 3000 && document.querySelectorAll('.badge.suggest').length === 0) { await sleep(200); waited += 200; }
  const rowH = (el) => Math.round(el.getBoundingClientRect().height);
  const rows = () => [...document.querySelectorAll('.row')];
  const dividers = () => [...document.querySelectorAll('.group-divider')];
  const marker = () => dividers().map(d => d.querySelector('.group-marker')?.textContent.trim());
  const badges = [...document.querySelectorAll('.badge.suggest')].map(b => ({ label: b.textContent.trim(), borderStyle: getComputedStyle(b).borderStyle }));
  const initRowCount = rows().length;
  const initRowHeights = [...new Set(rows().map(rowH))];
  const dividerHeights = [...new Set(dividers().map(rowH))];
  const initMarkers = marker();
  fireKey('G'); await tick(); const afterG = document.querySelector('.row.cursor .url')?.textContent;
  fireKey('g'); await tick(); const afterTop = document.querySelector('.row.cursor .url')?.textContent;
  fireKey('g'); await tick(); fireKey('j'); await tick(); fireKey('j'); await tick(); // cursor onto a grouped row
  fireKey('z'); await tick(); await sleep(100);
  const markersAfterZ = marker(); const rowCountAfterZ = rows().length;
  document.querySelector('.group-divider').click(); await tick(); await sleep(100);
  const markersAfterClick = marker(); const rowCountAfterClick = rows().length;
  return { initRowHeights, dividerHeights, initMarkers, badges, afterG, afterTop, markersAfterZ, rowCountAfterZ, markersAfterClick, rowCountAfterClick,
    pass: initRowHeights.join() === '28' && dividerHeights.join() === '28' && initMarkers.includes('▾')
       && badges.some(b => b.label === 'bookmarked' && b.borderStyle === 'dashed')
       && badges.some(b => b.label === 'stale login' && b.borderStyle === 'dashed')
       && afterG !== afterTop && markersAfterZ.includes('▸') && rowCountAfterZ === initRowCount - 3
       && markersAfterClick.includes('▾') && rowCountAfterClick === initRowCount };
}

// --- mvzz: virtualization at 200+ tabs ---------------------------------------
// Stage ~205 lightweight data: tabs + a 40-tab group from the OPTIONS page,
// runCleanup, then select the REVIEW page and run this. Asserts only a slice
// renders, rows are exactly 28px, scrollHeight == items*28 (no spacer drift),
// gg/G land + scroll the cursor, and a big group collapses to hide its members.
export async function mvzz_virtualizationDom() {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const tick = () => new Promise(r => requestAnimationFrame(() => r()));
  const fireKey = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  const review = await chrome.runtime.sendMessage({ type: 'getReview' });
  const prefix = `chrome-extension://${chrome.runtime.id}/`;
  const wtabs = (await chrome.tabs.query({ windowId: review.targetWindowId })).filter(t => t.url && !t.url.startsWith(prefix));
  const expectedItems = wtabs.length + new Set(wtabs.filter(t => t.groupId != null && t.groupId !== -1).map(t => t.groupId)).size;
  const vp = document.querySelector('.list-viewport');
  const renderedCount = document.querySelectorAll('.row, .group-divider').length;
  const rowHeights = [...new Set([...document.querySelectorAll('.row')].map(r => Math.round(r.getBoundingClientRect().height)))];
  const noDrift = vp.scrollHeight === expectedItems * 28;
  fireKey('G'); await tick(); await sleep(80);
  const afterG_scrollTop = Math.round(vp.scrollTop); const afterG_cursor = document.querySelector('.row.cursor .title')?.textContent;
  fireKey('g'); await tick(); await sleep(80);
  const afterTop_scrollTop = Math.round(vp.scrollTop); const afterTop_cursor = document.querySelector('.row.cursor .title')?.textContent;
  fireKey('g'); await tick(); for (let i = 0; i < 55; i++) fireKey('j'); await tick(); await sleep(120);
  const hBefore = vp.scrollHeight; fireKey('z'); await tick(); await sleep(150);
  const collapsedDelta = (hBefore - vp.scrollHeight) / 28; const marker = document.querySelector('.group-divider .group-marker')?.textContent.trim();
  document.querySelector('.group-divider').click(); await tick();
  return { expectedItems, renderedCount, rowHeights, noDrift, afterG_scrollTop, afterG_cursor, afterTop_scrollTop, afterTop_cursor, collapsedDelta, marker,
    pass: renderedCount < 60 && rowHeights.join() === '28' && noDrift && afterG_scrollTop > 1000
       && afterTop_scrollTop === 0 && afterTop_cursor === 't000' && collapsedDelta === 40 && marker === '▸' };
}

// --- b08q: side-panel page + assets load with no 404 -------------------------
// Open chrome-extension://<id>/src/sidepanel/sidepanel.html, then via the MCP:
//   list_network_requests({resourceTypes:["script","stylesheet","document"]})  -> all 200
//   list_console_messages({types:["error","warn"]})                            -> none
// and run this in the panel page to confirm it mounted:
export async function b08q_sidePanelMounted() {
  await new Promise(r => setTimeout(r, 600));
  return { bodyClass: document.body.className, hasApp: !!document.querySelector('.app, .header, .empty'),
    pass: document.body.className.includes('surface-sidepanel') && !!document.querySelector('.app, .header, .empty') };
}
