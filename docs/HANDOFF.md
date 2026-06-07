# Tabby — Handoff

**Next session focus:** Manual/Chrome-assisted verification of the built extension
on **macOS** (Chrome integration available), then decide on merging the branch
stack, then optionally start Phase 5 (side panel).

**Project:** Chrome MV3 extension for keyboard-driven tab cleanup
(consolidate → dedup → sort → review). Greenfield, authored entirely in this
session.

**Repo (Forgejo, homelab):** http://192.168.5.30:3000/mj/tabby
- Clone: `git clone ssh://git@192.168.5.30:2222/mj/tabby.git`
- All branches pushed (see stack below). Built/authored at
  `/home/mj/dev/projects/tabby` on the Linux box; clone fresh on the macOS
  machine to verify.

---

## Read these first (don't duplicate — they're authoritative)

- `DESIGN.md` — full design doc (workflow, URL categories, active-tab invariant,
  architecture §3, host-agnostic view §3.4, edge cases §4).
- `PLAN.md` — phased plan with checkboxes. Phases 0–4 are checked ✅; the one
  **unchecked box in each of Phases 0–4 is the manual verify** — that's the
  primary job for the next session. Phase 5 is unstarted/optional.
- `README.md` — dev commands, "Load the unpacked extension" steps, keymap.
- Git history: `git log --oneline` — one commit per phase, each message lists
  exactly what it added.

## Current state

- **v1.0 feature-complete.** 68 tests pass. CI gate green: `pnpm typecheck`,
  `pnpm lint`, `pnpm test`, `pnpm build`.
- Branch stack (linear, all pushed to `origin`; **nothing merged to `main`**):
  `main → phase-1-core → phase-2-orchestration → phase-3-review-ui → phase-4-settings`
  Check out `phase-4-settings` for v1.0. `main` is only Phase 0.
- Toolchain is intentionally very fresh: Vite 8, TypeScript 6, ESLint 10,
  Vitest 4, `@crxjs/vite-plugin` 2.4.0, Preact 10. Node 26 / pnpm 11 were used.

## What has NOT been verified in a real browser (the point of this session)

All logic is unit-tested, but the extension has never been exercised in Chrome
by the author of this code. Highest-risk areas, in order:

1. **Strip reorder with tab groups** (`src/background/executor.ts`, `applyPlan`).
   It moves the pinned block to index 0, then the rest (groups included, in
   sorted order) as a single `chrome.tabs.move` array call, relying on Chrome
   keeping group members contiguous because they're adjacent in the array. This
   is the single most likely thing to misbehave. Watch group integrity + order.
2. **Pinned tabs in non-focused windows stay put** (explicit product choice).
   Confirm they are NOT moved/closed and their window isn't reported empty.
3. **Blank-tab purge keeps the active tab** of each window (never rug-pull).
4. **Cross-window consolidation + dedup** end to end.
5. **Undo** (`u` / button) reopens closed tabs (restore-by-URL; group/pin state
   is intentionally not fully restored in v1).
6. **Settings actually change behavior** (e.g. toggle "Ignore ALL query params"
   then rerun and see more merges).

## Suggested verification procedure (macOS + Chrome)

1. On the macOS machine, in the repo: `pnpm install` then `pnpm build` → produces
   `dist/`.
2. Chrome → `chrome://extensions` → enable Developer mode → **Load unpacked** →
   select `dist/`. (Re-run `pnpm build` + click the reload icon after any code
   change.)
3. Set up a deliberately messy state: 2–3 windows; the same URL open several
   times across windows (incl. variants like `?utm_source=x`, `#frag`, trailing
   slash); a pinned tab in a non-focused window; a tab group of 2–3 tabs; a few
   `about:blank`/new-tab tabs (leave one blank tab active in a window).
4. Click the Tabby toolbar icon (or `Cmd+Shift+K`). Expected: everything gathers
   into the focused window, dupes + non-active blanks gone, the group stays
   intact and contiguous, the pinned tab untouched in its window, strip
   URL-sorted, and a review tab opens showing the summary + sorted list.
5. In the review list, exercise the keyboard fully (keymap is in `README.md` /
   `DESIGN.md §2.5`): `j/k`, `x`/space to mark, `V`+move+`x` range, `/` filter,
   `Cmd+Enter` to close marked, then `u` to undo. Confirm marked rows close and
   undo reopens them.
6. Open the options page (`chrome://extensions` → Tabby → Details → Extension
   options, or right-click icon → Options). Flip a setting (e.g. blank-tab
   policy, or "Ignore ALL query params"), confirm "Saved ✓", rerun cleanup, and
   confirm the outcome differs.

Capture anything that misbehaves with concrete repro (which tabs, which windows,
before/after). Fixes for executor/reorder land in `src/background/executor.ts`;
the pure planning is in `src/core/buildCleanupPlan.ts` (don't change core
behavior without updating its tests in `test/core/`).

## After verification — decisions waiting on the user

- **Merge strategy:** the stack is linear and fast-forwardable to `main`. User
  was asked whether to (a) FF-merge the stack to `main`, or (b) leave per-phase
  branches / open PRs (Forgejo shows "Create pull request" links for each).
  Don't merge without confirmation. Branches are already pushed.
- **Phase 5 (side panel)** is optional and unstarted — see `PLAN.md` Phase 5.
  The view is already host-agnostic (`src/view/ReviewView.tsx` depends only on
  `ReviewTransport`), so it's a thin `sidepanel` shell reusing the same
  component + an opt-in `sidePanel` permission flow. Only start if the user asks.

## Conventions established this session (keep following them)

- **`src/core/` stays pure** (no `chrome.*`), so it's unit-testable without a
  browser. Chrome access is confined to `src/background/` and the view's
  transport. Maintain this split.
- Each phase = its own commit with a detailed body; commit messages end with the
  `Co-Authored-By: Claude Opus 4.8` trailer (per repo/global guidance).
- Per global workflow: **branch before committing to `main`; commit/push only
  when the user asks.**
- After any change, re-run the four-part gate (typecheck/lint/test/build) before
  declaring done.
- Pure logic gets pure tests; Chrome glue is dependency-injected and tested with
  fakes (see `src/background/executor.ts` `TabsDriver` + `test/background/`).

## Suggested skills for the next session

- **`/browse`** (gstack) — per the user's `CLAUDE.md`, use this for ALL web
  browsing / Chrome driving. **Do NOT use `mcp__claude-in-chrome__*` tools.**
  Likely paired with **`/connect-chrome`** to attach to the user's Chrome for
  loading/exercising the unpacked extension.
- **`/verify`** — run the app and observe behavior to confirm the change works;
  fits the "exercise the extension and confirm it does what it should" task.
- **`/qa`** (gstack) — if a more structured QA pass of the UI is wanted.
- **`/code-review`** — before merging the stack to `main`, review the cumulative
  diff (`git diff main...phase-4-settings`).
