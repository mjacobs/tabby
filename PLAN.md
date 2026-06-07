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

- [ ] `background/executor.ts` — apply a plan via `chrome.tabs.move`,
      `chrome.tabGroups.move`, `chrome.tabs.remove`; tolerate missing tab ids.
- [ ] `background/orchestrator.ts` — snapshot → `buildCleanupPlan` → execute →
      record auto-dedup closes → open/focus review page with surviving set.
- [ ] `background/undo.ts` — close buffer + `chrome.sessions.restore` fallback.
- [ ] `background/messaging.ts` — typed worker↔view contract.
- [ ] Wire toolbar action **and** `run-cleanup` command to the orchestrator.
- [ ] **Verify manually:** open 3 windows with overlapping dupes incl. a pinned
      tab and a tab group → trigger → tabs gather into focused window, dupes
      gone, groups intact, pinned untouched, strip sorted.

**Exit:** the consolidate→dedup→sort pipeline works end-to-end on real tabs;
review page opens (UI can still be placeholder).

---

## Phase 3 — Review view, keyboard-first (1.5 days)

Goal: the keep/remove review experience from DESIGN §2.5.

- [ ] `view/state.ts` — cursor, marks set, filter, derived counters.
- [ ] `view/ReviewView.tsx` + `row.tsx` — rows with favicon/url/title/badges,
      group headers, virtualized list.
- [ ] `view/keymap.ts` — full key map (j/k, x, X, V-range, /, a, u, enter,
      Cmd/Ctrl+Enter commit, ?, esc).
- [ ] `view/shells/page.tsx` — mount in `review.html` with page transport.
- [ ] Commit path → background closes marked tabs (recorded for undo).
- [ ] Live sync to `chrome.tabs.onRemoved/onUpdated`.
- [ ] `?` cheatsheet overlay.
- [ ] Tests: `@testing-library/preact` for key handling, marking, commit,
      filter, undo against a mock transport.
- [ ] **Verify manually:** prune ~30 tabs entirely from the keyboard; undo works.

**Exit:** full one-click → review → keyboard-prune → undo loop is usable daily.

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
