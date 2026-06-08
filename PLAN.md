# Tabby — Execution Plan

Phased build plan for the design in `DESIGN.md`. Each phase is independently
shippable/testable. Check items off as you go.

> **Verification status (2026-06-07):** Phases 0–4 verified in Chrome on macOS
> (driven via gstack's browser MCP). 5 of 6 risk areas passed on the first pass;
> the exception was **tab-group integrity** — the executor's reorder dissolved
> multi-tab groups down to their last member during consolidation. Fixed in
> `src/background/executor.ts` (commit `f2be518`) with a regression test, then
> re-verified intact in the browser. v1.0 stack fast-forwarded onto `main`.

---

## Phase 0 — Scaffold (½ day)

Goal: an empty extension that loads, with CI green.

- [x] `pnpm` project, TypeScript strict, Vite + `@crxjs/vite-plugin`.
- [x] `manifest.config.ts` per DESIGN §3.1 (action + command + permissions).
- [x] Placeholder `background/index.ts`, `review.html`, `options.html`.
- [x] ESLint + Prettier, Vitest configured.
- [x] GitHub Actions: typecheck · lint · test · build artifact.
- [x] **Verify:** loads as unpacked extension; pipeline runs. _(verified
      2026-06-07 on macOS — `dist/` loaded at chrome://extensions, no errors;
      `Cmd+Shift+K` runs cleanup and opens the review tab.)_

**Exit:** triggering Tabby opens `review.html`. ✅ (verified)

---

## Phase 1 — Core logic, pure & tested (1 day)

Goal: the whole pipeline as pure functions with no browser dependency.

- [x] `core/normalizeUrl.ts` — normalization pipeline + sort key (DESIGN §2.3).
- [x] `shared/urlPatterns.ts` — default tracking-param blocklist + glob match.
- [x] `core/dedupe.ts` — group by normalized URL, keep policies,
      pinned/audible/special exclusions → `{ keep, close, duplicateGroups }`.
- [x] `core/sortTabs.ts` — host→path→query ordering, pinned-lead, group contiguity.
- [x] `core/buildCleanupPlan.ts` — windows snapshot → declarative plan
      (moves, group-moves, closes), targeting the focused window.
- [x] Vitest tables: tracking params, fragments, trailing slash, pinned
      protection, group preservation, audible default, single-window no-op,
      keep-policy tie-breaks, cross-window dedup, new-window mode. (31 tests,
      ~96% core coverage.)

**Exit:** `pnpm test` covers every dedup/sort/normalize decision in DESIGN §4. ✅

---

## Phase 2 — Background orchestration (1 day)

Goal: trigger → real tabs get consolidated, deduped, sorted.

- [x] `background/snapshot.ts` — chrome.windows → `TabInfo` (pure mapper) +
      review-tab exclusion.
- [x] `background/executor.ts` — injectable `TabsDriver` + `applyPlan`
      (move/group-move/remove/createWindow); tolerant of missing tab ids.
- [x] `background/orchestrator.ts` — snapshot → `buildCleanupPlan` → record
      undo → execute → stash review state → open/focus review page.
- [x] `background/undo.ts` — storage.session close buffer + restore.
      (chrome.sessions.restore upgrade deferred — see DESIGN §2.6.)
- [x] `shared/messages.ts` + `background/messageHandlers.ts` — typed
      worker↔view contract (getReview/jumpTo/commitClose/undo/closeEmptyWindows).
- [x] Wire toolbar action **and** `run-cleanup` command to the orchestrator.
- [x] Review placeholder reads the stashed summary (proves the pipeline).
- [x] Tests: fake-driver `applyPlan` sequencing + pure mapper (48 tests total).
- [x] **Verify manually:** 2 windows with cross-window dupes incl. a pinned tab
      and a tab group → trigger → tabs gather into focused window, dupes gone,
      pinned untouched, strip sorted. _(verified 2026-06-07. **Group integrity
      initially FAILED** — the reorder moved grouped tabs by id, which ejects
      them, dissolving multi-tab groups to their last member. Fixed in
      `executor.ts` (move groups via `chrome.tabGroups.move`; commit `f2be518`)
      + regression test, then re-verified: a 3-tab group consolidated
      cross-window fully intact.)_

**Exit:** the consolidate→dedup→sort pipeline works end-to-end on real tabs;
review page opens with a live summary. ✅ (verified; group-integrity bug fixed)

---

## Phase 3 — Review view, keyboard-first (1.5 days)

Goal: the keep/remove review experience from DESIGN §2.5.

- [x] `view/state.ts` — cursor, marks set, filter, visual-range, derived counts.
- [x] `view/ReviewView.tsx` + `Row.tsx` — rows with favicon/url/title/badges,
      group dividers. (Virtualization deferred — note below.)
- [x] `view/keymap.ts` — key map (j/k, g/G, x/space, V-range, a/A, /, u, enter,
      Cmd/Ctrl+Enter commit, ?, esc).
- [x] `view/transport.ts` + page shell (`review/review.tsx`) — mounts the
      host-agnostic ReviewView with the chrome transport.
- [x] Commit path → background closes marked tabs (recorded for undo).
- [x] Live sync to `chrome.tabs.onRemoved/onUpdated` via the transport.
- [x] `?` cheatsheet overlay.
- [x] Tests: pure state + keymap; jsdom component tests (load→mark→commit→remove,
      cursor move, jump) against a fake transport. (66 tests total.)
- [x] **Verify manually:** keyboard prune + undo. _(verified 2026-06-07 — `G`
      jump, `x` mark, `Cmd+Enter` closed the real tab, `u` reopened it by URL;
      header counts/marks tracked correctly throughout.)_

> Deferred: list virtualization (fine for typical counts; revisit for 500+),
> collapsible group headers, and the `gg` two-key top (single `g` used instead).

**Exit:** full one-click → review → keyboard-prune → undo loop is usable daily.
✅ (pending the manual keyboard pass)

---

## Phase 4 — Settings & polish (1 day)

Goal: configurable, friendly, ready to rely on.

- [x] `options/options.tsx` + `options.css` over `chrome.storage.sync` — every
      `Settings` field (normalize toggles, tracking-param editor, keep policy,
      protect pinned/audible, preserve groups, blankTabPolicy, consolidate
      target, confirm-before-commit); auto-save + reset.
- [x] `confirmBeforeCommit` threaded into `ReviewState` and honored on commit.
- [x] Empty/edge states: nothing-to-review and no-filter-match handled in the
      review view; close-empty-windows offered in the header.
- [x] Icons (16/32/48/128) from an SVG, wired into `action` + `icons`.
- [x] README refreshed to v1.0 with the keymap.
- [x] **Verify (automated):** `stripAllQuery` / `ignoreWww` change dedup results
      (dedupe tests). _(manual verified 2026-06-07 — toggled "Ignore ALL query
      params" in the options page; the next run merged two query-variant tabs
      that had stayed distinct under defaults.)_

**Exit:** v1.0 — daily-driver quality for the author's workflow. ✅

---

## Phase 5 — Side panel surface

Goal: cash in the host-agnostic design.

- [x] `src/sidepanel/sidepanel.tsx` mounts the **same** `ReviewView` with the
      same `chromeTransport` — no view-logic fork. CSS adds a narrow-frame
      variant under `body.surface-sidepanel` (hides the URL column, wraps the
      header) without touching the component.
- [x] Optional `sidePanel` permission requested on opt-in from the options
      page (`chrome.permissions.request` inside the user-gesture click);
      saved only on grant, with a denial hint on cancel.
- [x] Surface selector in options ("Review surface" section: page | side
      panel), backed by `Settings.preferredSurface` (default `page`).
- [x] Orchestrator routes the trigger: when the user prefers the side panel
      *and* the permission is granted, it calls `chrome.sidePanel.setOptions`
      + `chrome.sidePanel.open({ windowId })`. Falls back to the page tab if
      the API isn't available or the call fails. Trigger handlers thread the
      originating `windowId` through so the open call has the gesture context
      it needs.
- [ ] **Verify manually:** identical review behavior in both surfaces.

**Exit:** user can switch surfaces per situation.

---

## Sequencing notes

- Phases 1→2→3 are the critical path to a usable tool; 0 is prep, 4 is polish,
  5 is a deferred enhancement.
- The pure-`core/` split (Phase 1) is the highest-leverage investment — it makes
  every later phase testable without a browser and keeps Chrome quirks contained
  to `background/` and the shells.
- Rough estimate to v1.0 (Phases 0–4): ~**5 days** of focused work.

## Definition of done (v1.0)

- One click / one shortcut runs consolidate→dedup→sort and opens review.
- Review is fully keyboard-operable; every close is undoable.
- Pinned tabs and tab groups are provably preserved (covered by tests, incl. an
  executor regression test guarding group membership through the reorder — added
  after the 2026-06-07 real-browser find).
- Settings persist and meaningfully change behavior.
- CI green: typecheck, lint, unit tests, build.
