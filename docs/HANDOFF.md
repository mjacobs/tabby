# Tabby — Handoff

**Status (2026-06-07):** v1.0 (Phases 0–4) **verified in Chrome on macOS** and
feature-complete. One defect was found during verification — multi-tab groups
were dissolved during consolidation — **fixed** (`src/background/executor.ts`,
commit `f2be518`) with a regression test and **re-verified intact** in the
browser. The v1.0 stack is fast-forwarded onto `main` **locally**; not yet
pushed (see "Remaining").

**Project:** Chrome MV3 extension for keyboard-driven tab cleanup
(consolidate → dedup → sort → review). Greenfield.

**Repo (Forgejo, homelab):** http://192.168.5.30:3000/mj/tabby
- Clone: `git clone ssh://git@192.168.5.30:2222/mj/tabby.git`

---

## Read these first (authoritative)

- `DESIGN.md` — full design (workflow, URL categories, active-tab invariant,
  architecture §3, host-agnostic view §3.4, edge cases §4).
- `PLAN.md` — phased plan. Phases 0–4 done; their manual-verify boxes are now
  checked, with the group-bug note. Phase 5 (side panel) is optional/unstarted.
- `README.md` — dev commands, "load the unpacked extension" steps, keymap.

## Current state

- **v1.0 verified + feature-complete.** Gate green: `pnpm typecheck`,
  `pnpm lint`, `pnpm test` (**69 tests**), `pnpm build`.
- **Git:** commit `f2be518` (the executor fix) sits on `phase-4-settings`, and
  `main` was fast-forwarded to it — the whole linear stack is collapsed onto
  `main` locally. Intermediate phase branches (`phase-1-core` …
  `phase-3-review-ui`) are unchanged ancestors.
- Toolchain (intentionally fresh): Vite 8, TypeScript 6, ESLint 10, Vitest 4,
  `@crxjs/vite-plugin` 2.4.0, Preact 10. Built with Node ≥24 / pnpm 11.

## What the verification found

Driven through **gstack's browser MCP** against the real Agent-profile Chrome.
(The `claude-in-chrome` MCP turned out to be blocked from `chrome-extension://`
pages and can't fire the trigger; gstack's AppleScript-based `Control_Chrome`
*can* open extension pages, read the review DOM, and dispatch keymap
`KeyboardEvent`s — but has **no `chrome.*` access**, so the messy
multi-window / group / pinned setup and the `Cmd+Shift+K` trigger had to be done
by hand. Worth knowing for the next live session.)

| # | Risk area | Result |
|---|-----------|--------|
| 1 | Strip reorder with tab groups | **Found + fixed** (below) |
| 2 | Pinned tab in non-focused window stays put; not reported empty | ✅ |
| 3 | Blank-tab purge keeps the active tab | ✅ |
| 4 | Cross-window consolidation + dedup (active kept) | ✅ |
| 5 | Undo reopens closed tabs | ✅ |
| 6 | Settings actually change behavior | ✅ |

### The bug + fix (risk #1)

`applyPlan`'s final reorder moved every survivor — group members included — in a
single `chrome.tabs.move`. Moving a grouped tab by id **ejects it from its
group**, so a 3-tab group dissolved down to its last member (positions stayed
contiguous; group membership didn't). The unit tests missed it because the fake
`TabsDriver` never modeled group ejection — the bug lived exactly in the gap
between the fake and a real browser.

**Fix** (`executor.ts`): reorder pinned-first, then walk the sorted survivors
placing **whole groups via `chrome.tabGroups.move`** and only **ungrouped tabs
via `chrome.tabs.move`** — grouped tab ids never pass through `moveTabs`. Added a
regression test (fails on the old reorder, passes on the new) and updated the
existing executor tests to the unit-by-unit strategy.

> Deliberate trade-off: the executor no longer re-sorts tabs *within* a group
> (doing so requires moving members by id, which re-breaks the group), so a
> group keeps Chrome's preserved internal order while the review list still
> shows the URL-sorted order. Restoring within-group sort safely is a separate,
> carefully-verified change.

## Remaining / next steps

1. **Push** — `origin` (homelab `192.168.5.30:2222`) was **unreachable** from the
   macOS machine during this session ("No route to host"). Run
   `git push origin main phase-4-settings` from the homelab network / VPN.
2. **Within-group sort** (optional) — see the trade-off note above.
3. **Phase 5 — side panel** (optional, unstarted) — see `PLAN.md` Phase 5. The
   view is already host-agnostic (`src/view/ReviewView.tsx` depends only on
   `ReviewTransport`), so it's a thin `sidepanel` shell reusing the same
   component + an opt-in `sidePanel` permission flow. Only start if asked.

## Conventions (keep following)

- **`src/core/` stays pure** (no `chrome.*`); Chrome access is confined to
  `src/background/` and the view's transport. Maintain this split.
- Pure logic gets pure tests; Chrome glue is dependency-injected and tested with
  fakes — **but keep the fakes honest about browser quirks.** The executor fake
  now models group ejection, because that gap is exactly where the group bug
  hid.
- Commit messages end with the `Co-Authored-By: Claude Opus 4.8` trailer.
  Branch before committing to `main`; commit/push only when asked.
- After any change, re-run the four-part gate (typecheck/lint/test/build). Note:
  the gate command is `pnpm test` (= `vitest run`); `pnpm test run` passes a
  stray filter and silently runs **zero** tests.
