# Tabby — Design Doc

A Chrome extension for fast, keyboard-driven tab cleanup.

Status: Draft v1 · Owner: mjacobs · Last updated: 2026-06-06

---

## 1. Overview

Tabby collapses a day's worth of sprawling, duplicated browser tabs into a
single reviewable list, then lets the user prune it with the keyboard in
seconds. It is built around one specific workflow (the author's), optimized for
**fewest clicks to trigger** and a **keyboard-first review**.

### The core loop

One trigger runs a three-stage pipeline, then drops the user into a review list:

```
        ┌─────────────┐   ┌───────────┐   ┌────────┐        ┌──────────────────┐
trigger │ Consolidate │ → │ Deduplicate│ → │  Sort  │  →     │  Review (keyboard)│
(1 click)└─────────────┘   └───────────┘   └────────┘        └──────────────────┘
        gather all tabs   collapse normalized   order by URL    mark → commit close
        into focused win   duplicate URLs       for scanning    with undo
```

1. **Consolidate** — move tabs from every window into the focused window.
   (Must run first so cross-window duplicates become visible to dedup.)
2. **Deduplicate** — collapse tabs whose *normalized* URL matches; keep the
   most-recently-active copy, close the rest.
3. **Sort** — order remaining tabs by normalized URL so near-identical pages sit
   adjacent and are easy to scan.
4. **Review** — present the surviving tabs as a list with a keyboard-driven
   keep/remove interface and an undo safety net.

### Goals

- Trigger the whole consolidate→dedup→sort pipeline in **one click** (or one
  keyboard shortcut).
- Make the review step fully operable **without the mouse**.
- **Never lose a tab silently** — every close is undoable.
- Be predictable and conservative: protect pinned tabs and tab groups.

### Non-goals (v1)

- Tab session save/restore beyond a short undo window.
- Auto/scheduled cleanup or background nagging — cleanup is always user-initiated.
- Cross-device or cloud sync.
- Bookmark integration, tab suspension/discarding, or memory management.
- Fancy ML grouping. Sorting is lexical by URL, nothing smarter.

---

## 2. Detailed feature spec

### 2.1 Trigger

- **Toolbar action** (`chrome.action`): clicking the Tabby icon runs the full
  pipeline and opens the review page. This is the "1 click" path.
- **Keyboard command** (`chrome.commands`): a configurable shortcut
  (default suggestion `Ctrl+Shift+K` / `Cmd+Shift+K`) does the same without
  touching the mouse.
- The pipeline is **idempotent-ish**: running it on an already-clean window just
  re-sorts and opens the review with nothing to remove.

### 2.2 Consolidate

- Determine the target window = the currently focused normal window.
- Move every tab from all other **normal** windows into the target window
  (`chrome.tabs.move`).
- **Tab groups are preserved**: a grouped tab is moved as part of its group via
  `chrome.tabGroups.move(groupId, { windowId, index })`, so group membership and
  color/title survive the move.
- **Pinned tabs are protected**: they are not moved out of their window and not
  considered for dedup or removal. (Pinned tabs in non-target windows stay put;
  see Edge Cases.)
- Skip non-normal windows (popups, devtools, the Tabby review page itself, app
  windows).
- After consolidation, other normal windows may be empty; Tabby offers (does not
  force) to close now-empty windows in the review UI.

### 2.3 Deduplicate

A duplicate is defined by **normalized URL equality**.

**Normalization pipeline** (each step toggleable in settings; defaults shown):

| Step                        | Default | Example                                              |
| --------------------------- | ------- | ---------------------------------------------------- |
| Lowercase scheme + host     | on      | `HTTP://Ex.com` → `http://ex.com`                    |
| Drop fragment (`#...`)      | on      | `ex.com/p#sec` → `ex.com/p`                          |
| Strip tracking params       | on      | removes `utm_*`, `fbclid`, `gclid`, `ref`, `mc_*`    |
| Drop trailing slash on path | on      | `ex.com/p/` → `ex.com/p`                             |
| Ignore `www.`               | off     | `www.ex.com` vs `ex.com` treated same when on        |
| Strip *all* query params    | off     | aggressive; off by default to avoid false merges     |

- Tracking-param blocklist is user-editable (textarea of patterns, supports
  `prefix*` globs).
- Normalization is **comparison-only** — the tab's real URL is never rewritten.
- **Keep policy: most-recently-active.** Within a duplicate group, keep the tab
  with the greatest `lastAccessed`; close the others.
- **Audible tabs are NOT protected by default** — a duplicate currently playing
  audio can be closed. Setting `protectAudible` (default off) flips this.
- Pinned tabs are excluded from dedup entirely (a pinned tab is never closed and
  never counts as the "kept" copy that closes an unpinned one — they're a
  separate space).
- Closes from this stage are recorded in the undo buffer (§2.6) just like manual
  closes, so an over-eager auto-dedup is fully recoverable.

### 2.4 Sort

- Remaining tabs are ordered by a **sort key derived from the normalized URL**:
  `host` (registrable domain first, then subdomain) → `path` → `query`.
- This clusters same-site and near-identical pages adjacently, which is what
  makes the review scan fast.
- Pinned tabs and tab groups: pinned tabs keep their leading position; grouped
  tabs are sorted **within** their group, and groups are kept contiguous (we do
  not interleave a group's tabs with ungrouped ones).
- The physical tab strip is reordered to match (`chrome.tabs.move`) so the strip
  and the review list agree.

### 2.5 Review UI (keyboard-first)

The deliverable surface for v1 is a **full extension page** (`review.html`
opened as a `chrome-extension://` tab). The view logic is written to be
**host-agnostic** so the same component can later mount in a **side panel**
(see §3.4).

**Layout**

```
┌ Tabby ───────────────────────────── 38 tabs · 6 to close · 1 window ┐
│ [/] filter…                                          [↩ Undo] [✓ Done]│
├──────────────────────────────────────────────────────────────────────┤
│ ▸ ⚲ github.com                                                        │  ← group header (collapsible)
│ >   ◉ github.com/mjacobs/tabby/issues/1      "Issue: dedup"          │  ← cursor (>) on this row
│     ◯ github.com/mjacobs/tabby/pulls         "Pull requests"          │
│   ✕ ◯ github.com/mjacobs/tabby/pulls?utm=x   "Pull requests"  [dup]   │  ← marked for close (✕)
│     ◯ news.ycombinator.com                   "Hacker News"            │
│     ◯ news.ycombinator.com/item?id=123       "Show HN: …"            │
└──────────────────────────────────────────────────────────────────────┘
 j/k move · x mark · X mark-rest-of-dup · enter jump · space preview · u undo · ⏎done
```

**Row content:** favicon, normalized URL (with the distinguishing tail of the
real URL emphasized), tab title, and badges (`[dup]`, `[audio]`, `[pinned]`,
`[group]`).

**Interaction model: mark-to-close (safe by default).**
Every tab starts as **keep**. The user marks the ones to **close**, then commits.
Nothing closes until commit, and commit is itself undoable.

**Keyboard map**

| Key                     | Action                                                          |
| ----------------------- | -------------------------------------------------------------- |
| `j` / `↓`, `k` / `↑`    | Move cursor down / up                                           |
| `g g` / `G`             | Jump to top / bottom                                            |
| `x` / `d` / `space`     | Toggle "close" mark on current row                             |
| `X`                     | Mark all *other* members of the current row's duplicate group  |
| `V` then `j`/`k`        | Visual range select, then `x` to mark the range                |
| `enter`                 | Jump to (activate) this tab in its window                       |
| `o`                     | Open preview / focus without leaving review                    |
| `/`                     | Filter list by substring (title or URL); `esc` clears          |
| `a`                     | Toggle "mark all duplicates" across the whole list             |
| `u`                     | Undo last close (multi-level)                                  |
| `⏎` (Cmd/Ctrl+Enter)    | **Commit**: close all marked tabs                              |
| `esc`                   | Close the review page (no destructive action)                  |
| `?`                     | Toggle keyboard cheatsheet overlay                             |

- Mouse is fully supported too (click row = cursor, click checkbox = mark,
  click title = jump) — keyboard is just the optimized path.
- Live counters in the header update as you mark.

### 2.6 Safety / Undo

- A session-scoped **undo buffer** records every closed tab (URL, title,
  pinned/group state, original window) for both auto-dedup and manual commits.
- `u` restores the most recent close; the buffer persists for the lifetime of
  the review page and a short grace window after.
- Restores use `chrome.sessions.restore` where possible (preserves history),
  falling back to opening the stored URL.
- A pre-commit summary ("Close 6 tabs?") can be enabled in settings for users who
  want a confirm step; default is **no confirm** (undo is the safety net) to keep
  it one-keystroke fast.

### 2.7 Settings

A small options page (`options.html`) backed by `chrome.storage.sync`:

- Normalization toggles + editable tracking-param blocklist (§2.3).
- `protectAudible` (default off), `protectPinned` (default on, exposed for
  completeness), `preserveGroups` (default on).
- Keep policy: most-recently-active (default) | oldest | leftmost.
- Consolidate target: focused window (default) | new window.
- Confirm-before-commit (default off).
- Keyboard shortcut hint (actual binding managed at `chrome://extensions/shortcuts`).
- Preferred surface: page (default) | side panel — wired once the side panel
  shell lands.

---

## 3. Architecture

### 3.1 Manifest V3 shape

```jsonc
{
  "manifest_version": 3,
  "name": "Tabby",
  "action": { "default_title": "Tabby: clean up tabs" },
  "background": { "service_worker": "background.js", "type": "module" },
  "permissions": ["tabs", "tabGroups", "storage", "sessions"],
  "optional_permissions": ["sidePanel"],
  "commands": {
    "run-cleanup": {
      "suggested_key": { "default": "Ctrl+Shift+K", "mac": "Command+Shift+K" },
      "description": "Consolidate, dedup, sort, and review tabs"
    }
  }
}
```

- `tabs` gives us `tab.url`/`tab.title` without host permissions — no broad host
  access requested, which keeps the install prompt friendly.
- `tabGroups` for preserving/moving groups. `sessions` for undo/restore.
- `sidePanel` is *optional* and requested only when the user opts into that
  surface.

### 3.2 Components

```
┌──────────────────┐      message       ┌────────────────────────┐
│ Toolbar action / │  ───────────────▶  │ background service     │
│ command          │                    │ worker (orchestrator)  │
└──────────────────┘                    └───────────┬────────────┘
                                                     │ calls
                                          ┌──────────▼───────────┐
                                          │ core/ (pure logic)   │
                                          │ normalize · dedup ·  │
                                          │ sort · plan          │
                                          └──────────┬───────────┘
   open + data                                       │ tab ops
        │                                ┌───────────▼───────────┐
        ▼                                │ chrome.tabs / tabGroups│
┌────────────────────┐   messages        └────────────────────────┘
│ review view (host- │ ◀──────────────▶ background (live tab state,
│ agnostic component)│                   commit close, undo)
└─────────┬──────────┘
          │ mounted by
   ┌──────┴───────────────────────┐
   │ page shell (review.html) [v1]│
   │ side-panel shell      [later]│
   └──────────────────────────────┘
```

### 3.3 Module breakdown

- **`core/` (no Chrome APIs — pure, unit-tested):**
  - `normalizeUrl(url, settings)` → normalized string + sort key.
  - `dedupe(tabs, settings)` → `{ keep, close, groups }` plan.
  - `sortTabs(tabs, settings)` → ordered list.
  - `buildCleanupPlan(windows, settings)` → a declarative plan (moves, closes,
    group moves) that the background worker executes. Keeping planning pure makes
    the whole pipeline testable without a browser.
- **`background/` (Chrome API glue):**
  - `orchestrator.ts` — on trigger: snapshot windows → `buildCleanupPlan` →
    execute moves/group-moves → execute auto-dedup closes (recorded for undo) →
    open/focus review page, hand it the surviving tab set.
  - `executor.ts` — applies a plan via `chrome.tabs.move`, `chrome.tabGroups.move`,
    `chrome.tabs.remove`; idempotent and resilient to tabs that vanished mid-run.
  - `undo.ts` — the close buffer + restore.
  - `messaging.ts` — typed message contract between worker and review view.
- **`view/` (host-agnostic UI):**
  - `ReviewView` component + `keymap.ts` + `state.ts` (cursor, marks, filter).
    Receives tab data and emits intents (`mark`, `commit`, `jump`, `undo`) over
    the messaging contract — it never calls Chrome APIs directly. This is what
    makes the page↔side-panel swap a shell change, not a rewrite.
  - `shells/page.ts` and (later) `shells/sidepanel.ts` — thin mount points.
- **`options/`** — settings page.
- **`shared/`** — `types.ts`, `settings.ts` (load/save + defaults).

### 3.4 Host-agnostic review view (page now, side panel later)

The review UI is a single component that depends only on:
1. an injected **transport** (how it talks to the background worker), and
2. an injected **host capabilities** object (e.g., "can I close myself?",
   viewport hints).

`shells/page.ts` mounts it in `review.html`; a future `shells/sidepanel.ts`
mounts the same component in the side panel and requests the `sidePanel`
permission on demand. No view logic forks. This directly honors the "start with
full page, keep the side-panel door open" decision.

### 3.5 Data flow & edge handling during the run

- The worker takes a **snapshot** of all windows/tabs at trigger time and plans
  against it; the executor tolerates drift (a tab closed by the user mid-run is
  skipped, not fatal).
- The review view subscribes to `chrome.tabs.onRemoved/onUpdated` (via the
  worker) so the list stays truthful if the user closes a tab in the strip while
  reviewing.

---

## 4. Edge cases & decisions

| Case                                   | Behavior                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------ |
| Pinned tab is a duplicate              | Left untouched; never closed, never moved.                               |
| Pinned tabs in non-focused windows     | Stay in place (moving them would unpin/relocate); reported in review.    |
| Tab is in a group                      | Group moved as a unit; membership/color/title preserved.                 |
| Duplicate playing audio                | Closeable by default; `protectAudible` setting protects it.              |
| `chrome://`, `about:`, extension pages | Eligible for consolidate/sort; **excluded from dedup** (often singletons) and the Tabby review page excludes itself. |
| Lazy/discarded tabs                    | `tab.url` still available with `tabs` perm; handled normally.            |
| Only one window, no dupes              | Pipeline just sorts; review opens showing "nothing to remove."           |
| Incognito windows                      | Out of scope v1 unless extension is allowed in incognito; skipped.       |
| Huge tab counts (500+)                 | Review list is virtualized; moves/closes are batched.                    |
| Tab closed by user mid-run             | Executor skips missing tab ids gracefully.                               |

---

## 5. Tech stack & tooling

- **Language:** TypeScript (strict).
- **Build:** Vite + [`@crxjs/vite-plugin`](https://crxjs.dev) for MV3 bundling,
  HMR, and manifest generation.
- **UI:** Preact (tiny, fast) for the review/options views; core logic stays
  framework-free.
- **State:** plain signals/store in `view/state.ts` — no heavy state lib needed.
- **Testing:** Vitest for `core/` (normalization, dedup, sort, plan) +
  `@testing-library/preact` for the review view; a thin mock of the messaging
  transport. Optionally Playwright for one end-to-end smoke test against a loaded
  unpacked extension.
- **Lint/format:** ESLint + Prettier (or Biome).
- **CI:** GitHub Actions — typecheck, lint, unit tests, build the unpacked zip
  artifact.

### Suggested layout

```
tabby/
  manifest.config.ts        # @crxjs manifest
  src/
    core/        normalizeUrl.ts dedupe.ts sortTabs.ts buildCleanupPlan.ts
    background/  index.ts orchestrator.ts executor.ts undo.ts messaging.ts
    view/        ReviewView.tsx keymap.ts state.ts row.tsx
      shells/    page.tsx (+ sidepanel.tsx later)
    options/     options.tsx
    shared/      types.ts settings.ts urlPatterns.ts
  review.html  options.html
  test/        core/*.test.ts view/*.test.ts
  DESIGN.md  PLAN.md  README.md
```

---

## 6. Open questions / future

- **Side panel** as a first-class selectable surface (architecture already
  supports it).
- **Named sessions / "stash"**: send a set of reviewed tabs to a saved list
  instead of closing (bookmark folder or storage).
- **Smarter grouping** beyond lexical URL sort (by domain, by topic).
- **Per-window cleanup** mode (dedup within current window only, no consolidate).
- **Telemetry-free usage counts** purely local, to tune defaults.

See `PLAN.md` for the phased execution plan.
