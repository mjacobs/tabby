# Tabby — Execution Plan

Phased build plan for the design in `DESIGN.md`. Each phase is independently
shippable/testable. Check items off as you go.

---

## Phase 0 — Scaffold (½ day)

Goal: an empty extension that loads, with CI green.

- [x] `pnpm` project, TypeScript strict, Vite + `@crxjs/vite-plugin`.
- [x] `manifest.config.ts` per DESIGN §3.1 (action + command + permissions).
- [x] Placeholder `background/index.ts`, `review.html`, `options.html`.
- [x] ESLint + Prettier, Vitest configured.
- [x] GitHub Actions: typecheck · lint · test · build artifact.
- [ ] **Verify:** loads as unpacked extension; toolbar icon appears. _(manual —
      `pnpm build` succeeds; load `dist/` at chrome://extensions to confirm)_

**Exit:** clicking the icon opens `review.html`. ✅ (pending the manual load)

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
- [ ] **Verify manually:** open 3 windows with overlapping dupes incl. a pinned
      tab and a tab group → trigger → tabs gather into focused window, dupes
      gone, groups intact, pinned untouched, strip sorted.

**Exit:** the consolidate→dedup→sort pipeline works end-to-end on real tabs;
review page opens with a live summary. ✅ (pending the manual multi-window check)

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
- [ ] **Verify manually:** prune ~30 tabs entirely from the keyboard; undo works.

> Deferred: list virtualization (fine for typical counts; revisit for 500+),
> collapsible group headers, and the `gg` two-key top (single `g` used instead).

**Exit:** full one-click → review → keyboard-prune → undo loop is usable daily.
✅ (pending the manual keyboard pass)

---

## Phase 4 — Settings & polish (1 day)

Goal: configurable, friendly, ready to rely on.

- [ ] `options/options.tsx` + `shared/settings.ts` over `chrome.storage.sync`
      (normalization toggles, blocklist editor, keep policy, protectAudible,
      consolidate target, confirm-before-commit).
- [ ] Empty/edge states: nothing-to-remove, single window, 500+ tabs.
- [ ] Offer to close now-empty windows post-consolidate.
- [ ] Icons (16/32/48/128), name/description, README.
- [ ] **Verify:** changing normalization aggressiveness changes dedup results.

**Exit:** v1.0 — daily-driver quality for the author's workflow.

---

## Phase 5 — Side panel surface (later, optional)

Goal: cash in the host-agnostic design.

- [ ] `view/shells/sidepanel.tsx` mounting the **same** `ReviewView`.
- [ ] Request `sidePanel` optional permission on opt-in.
- [ ] Surface selector in options (page | side panel).
- [ ] **Verify:** identical review behavior in both surfaces, no view-logic fork.

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
- Pinned tabs and tab groups are provably preserved (covered by tests).
- Settings persist and meaningfully change behavior.
- CI green: typecheck, lint, unit tests, build.
