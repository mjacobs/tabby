# Tree / outliner view of tabs — design notes

**Tracking issue:** kata `3ce9` (design spike)
**Status:** design draft (2026-06-17). Longer-horizon surface — explicitly *not*
v1 of Tabby; this doc settles the model and the v1 cut so a future implementer
can start without re-deriving it.
**Reuses:** the `9kb5` close-recommendation classifier
(`docs/close-recommendation-design.md`, `src/core/recommend.ts`).

## The CUJ this serves: "tab overload → grounded state"

This is the **same journey** the close-recommendation feature serves, not a new
one:

> Tabs accumulate over a browsing/work session until you literally can't see
> what you have open. At that point you want to "default" your browser back to a
> grounded state — clear the noise, keep what you actually care about.

Tabby's v1 already does the fast path: one trigger runs
consolidate→dedup→sort→review (`DESIGN.md` §1) and drops you into a flat,
keyboard-driven list to prune. The **flat list is deliberately ephemeral** —
it mirrors one window's live tabs for a single prune pass and then you close it.

The tree/outliner is the **persistent, structural** view of the same problem.
Where the review list answers "what should I close *right now*", the outliner
answers "what is the *shape* of everything I have open (and recently had open),
and where is the noise hiding". It is the surface you keep around when the flat
list is too small a lens — many windows, long-lived research piles, tabs you are
not ready to close but want *organized and de-noised at a glance*.

The differentiator over every existing tool is that the noise is **already
classified and flagged** by the time you open the tree, using the exact same
`recommendClosures` signals the review list uses — so "grounded state" is one
collapse/sweep away instead of a manual archaeology dig.

## Prior art (what we learn from / avoid)

- **Tabs Outliner** — the canonical "manipulable tree of windows and tabs"
  extension. A live + historical outline you can collapse, drag, annotate, and
  bulk-operate on; saved a generation of tab hoarders. **But:** closed-source,
  the author effectively vanished, freemium, and increasingly buggy on modern
  Chrome. No automatic notion of which tabs are *worth* keeping — every bit of
  triage is manual.
- **Link Map** — the semi-maintained spiritual successor. Same closed-source
  freemium model, same lack of automatic noise classification, same "you do all
  the sorting" burden.
- **OneTab** (covered in the `9kb5` doc) — the opposite extreme: one button
  dumps *all* tabs to a flat saved list. Blunt, and the saved list **inherits
  all the noise**. Lesson carried here: a structural view is only as valuable as
  it is *de-noised*.
- **Tabby v0 (`tabz`, `~/dev/projects/tabz`)** — the author's prior attempt
  included a **virtualized tab tree**; that prototype is the direct ancestor of
  this issue (recorded in the `9kb5` doc's lineage section). No code carries
  over, but it validates that this surface is one the author actually used.

**Why an open, maintained tool with automatic classification wins.** The tree
shape is commodity — Tabs Outliner and Link Map both have it. The unmet need is
**not having to hand-triage the tree**. Tabby already owns a high-precision
"interesting vs. noise" classifier (`9kb5`) that nothing in this space offers.
Bolting the tree onto that classifier turns "a tree you still have to clean by
hand" into "a tree that shows you what to clean." Open + maintained removes the
abandonment risk that killed the incumbents.

## How it reuses the `9kb5` classifier

This surface adds **zero new classification logic**. It is a new *view* over the
existing pure core. Concretely it reuses, by name:

- **`recommendClosures(tabs, ctx)` in `src/core/recommend.ts`** — the single
  entry point. It returns `Recommendation[]` (`{ tabId, reasons }`) where
  `reasons` is a list of `RecommendReason` (`'bookmarked' | 'stranded-auth'`).
  The tree calls exactly this, with the same `RecommendContext`
  (`bookmarkedUrls`, `normalize`, per-signal `options`). In the running
  extension the call already exists end-to-end: the view asks the worker via
  `transport.getRecommendations(tabs)` (`src/view/transport.ts`), which routes
  to the `getRecommendations` message handler (the worker computes it because
  bookmarked-URL lookup needs `chrome.bookmarks`). The tree subscribes to the
  same transport method — no new background plumbing.
- **`isStrandedAuthUrl(rawUrl)`** (same module) — the dead-login signal. The
  tree surfaces its result as a per-node "stranded login" flag. This is the
  signal that makes piled-up `chase.com/login`, `accounts.google.com/v3/signin/
  challenge/...`, `login.brev.nvidia.com/signin` etc. visible *as noise* the
  instant the tree paints.
- **The bookmarked signal** — `recommendClosures` normalizes each tab's URL via
  **`normalizeUrl(url, settings.normalize)`** (`src/core/normalizeUrl.ts`) and
  tests membership in `ctx.bookmarkedUrls`. The tree shows a "bookmarked"
  (already-saved → redundant) flag from the same result.
- **`normalizeUrl` + `sortTabs`** (`src/core/normalizeUrl.ts`,
  `src/core/sortTabs.ts`) — reused to make a node's URL canonical for matching
  and to order siblings within a window so near-identical pages cluster (the
  same host→path→query `sortKey` the review list scans by).
- **`dedupe(tabs, settings)`** (`src/core/dedupe.ts`) — its `duplicateGroups`
  output identifies same-URL clusters *within* a scope. The tree uses this to
  draw a "duplicate" affordance on nodes without re-implementing the math.
- **Cross-duplicate / recurrence signal (`9kb5` signal 3)** — a tab whose
  normalized URL recurs across windows/sessions/time (`Inbox (155)` ×6, repeated
  dashboards). This is *more* legible in a tree than a flat list because the tree
  spans multiple windows (and optionally history) at once. The recurrence count
  comes from the persistent records log
  (`src/background/records.ts` / `getRecords`), exactly as the `9kb5` doc
  anticipates; the tree is its most natural display surface. Treated as a
  **classifier signal**, not tree-specific logic — if/when it lands in
  `recommend.ts` the tree gets it for free.

Net: the tree's only job is to *render and operate on* the flags. "Automatic
noise classification" is delivered by `recommendClosures`; the tree makes it
*spatial*.

## The tree model

A two-level (v1) outline over the live tab strip:

```
Window 1  (focused)                              12 tabs · 3 flagged
├─ ▾ ⚲ research                                   group (collapsible)
│   ◯ react.dev/learn                "Quick Start"
│   ◯ react.dev/reference            "Reference"        [dup]
├─ ◯ news.ycombinator.com            "Hacker News"
├─ ⚑ chase.com/login                 "Sign in"          [stranded-auth]
└─ ⚑ react.dev/learn                 "Quick Start"      [bookmarked][dup]
Window 2                                          5 tabs · 2 flagged
└─ …
▸ Recently closed (chrome.sessions)               [opt-in, collapsed]
```

**Node kinds**

- **Window** — root-level container. Title = "Window N" + focused/incognito
  marker + tab count + *flagged* count (how many descendants `recommendClosures`
  flagged). Collapsing a window hides its subtree but keeps the flagged count
  visible — that count *is* the at-a-glance noise indicator.
- **Group** — a Chrome tab group (`tab.groupId`), nested under its window,
  carrying Chrome's color/title (queried like `transport.queryGroups`). Tabs
  outside any group are direct children of the window. This mirrors how the
  review list already renders group dividers (`src/view/renderItems.ts`).
- **Tab** — a leaf, one per `TabInfo`. Carries favicon, normalized URL, title,
  and badges. The flag badges are the **same** `bookmarked` / `stranded-auth`
  badges the review `Row` already renders (`src/view/Row.tsx`'s
  `REASON_BADGES`), plus the structural badges (`pinned`, `audio`, `group`,
  `active`, `dup`).

**Operations** (the "manipulable" part, deliberately small in v1):

- **Collapse / expand** any window or group node. (The flat list already has
  group collapse — `toggleCollapse` in `src/view/state.ts`, `kata#yrez` — and
  the outliner generalizes the same idea to windows.)
- **Bulk-operate on a subtree** — select a window/group node and act on all its
  tabs: *close*, *close-flagged-only* (the headline move: "sweep the noise out
  of this window"), *jump-to*. Close routes through the existing
  `transport.commitClose(ids)` → worker → `recordClosed` undo path, so the
  outliner inherits Tabby's undo for free.
- **Drag** — move a tab between windows/groups, or reorder. Maps onto
  `chrome.tabs.move` / `chrome.tabGroups.move` (the same primitives the
  `executor.ts` cleanup uses). **Drag is a v2 concern** (see scope); v1 ships
  read + collapse + bulk-close only.

## Should historical / recently-closed tabs be included?

**Recommended resolution: yes, but opt-in and read-mostly in v1.**

Chrome exposes recently-closed tabs and windows via
**`chrome.sessions.getRecentlyClosed()`** (already a Tabby dependency — the undo
buffer uses it in `src/background/undo.ts`, and the `sessions` permission is in
the manifest, `DESIGN.md` §3.1). The outliner adds a **collapsed-by-default
"Recently closed" root** populated from that API.

Rationale and boundaries:

- **Value:** history is where the "cross-duplicate / recurrence" signal becomes
  visible (`Inbox (155)` you keep reopening). A tab you closed and reopened five
  times is exactly the ambient-noise signal `9kb5` wants to surface.
- **Restore, don't fabricate:** historical nodes are **read + restore only**.
  The single action is *reopen*, via `chrome.sessions.restore(sessionId)` — the
  same call `undoLast()` already makes. We do **not** invent a parallel
  persistent history store in v1; `chrome.sessions` (capped at
  `MAX_SESSION_RESULTS = 25`) plus the records log
  (`src/background/records.ts`, capped at `MAX_RECORDS = 1000`) are enough.
- **Why opt-in:** historical nodes can't be classified for "stranded auth" the
  same way (the URL is a snapshot, and re-flagging a *closed* tab as closeable is
  nonsensical), and they bloat the tree. Off by default keeps the first paint
  about live tabs. A future deep "session timeline" built on a richer records
  store is explicitly a **separate, later issue**, not `3ce9`.

## Relationship to the existing v1 review list

**Recommended resolution: a NEW surface that reuses the same core + transport —
not an extension of `ReviewView`.** The two are different lenses on one CUJ and
should not be forced into one component.

Why not extend `ReviewView` (`src/view/ReviewView.tsx`):

- `ReviewView` is **single-window, flat, ephemeral, mark-to-close**. Its state
  (`src/view/state.ts`) models a cursor into one flat `visibleTabs` array, a
  `marked` set, and a filter. The outliner is **multi-window, hierarchical,
  persistent, subtree-operate**. Bending the flat cursor/marks model into a tree
  would complicate the surface that has to stay razor-fast for the daily prune.
- They *should* share everything below the component: the pure core
  (`recommend.ts`, `normalizeUrl.ts`, `sortTabs.ts`, `dedupe.ts`), the
  `ReviewTransport` interface (`src/view/transport.ts`), the row rendering
  vocabulary (`src/view/Row.tsx` badges), and `chrome.storage`-backed undo.

What we reuse directly:

- **`virtualize.ts`** (`computeWindow` / `scrollToShow`) — the outliner is a
  flattened, windowed list of render items just like the review list. The same
  uniform-row windowing math applies once the tree is flattened to a
  header/row item stream (the outliner's analogue of
  `renderItems`). This is the answer to "huge tab counts (500+)" from
  `DESIGN.md` §4 and the `kata#mvzz` virtualization work — **do not** render
  every node; flatten visible (expanded) nodes and slice.
- **The transport** — `getRecommendations`, `queryTabs`, `queryGroups`,
  `commitClose`, `undo`, `jumpTo`, `onTabsChanged` already give the outliner
  everything it needs. The one addition is a `queryWindows()` /
  `getRecentlyClosed()` pair (see sub-issues).
- **The host-agnostic shell pattern** — `DESIGN.md` §3.4: the outliner mounts in
  its own extension page (`outliner.html`) the same way `ReviewView` mounts in
  `review.html`, and could later mount in the side panel with no view rewrite.

A small bridge between the two surfaces: a "Review this window" affordance on a
window node opens the flat `ReviewView` scoped to that window. Tree = survey;
list = fast prune.

## Data / state model

Pure, Chrome-free, mirroring how `core/` and `view/state.ts` already split logic
from rendering.

### Source data (from the transport / worker)

- `TabInfo[]` per window (existing `transport.queryTabs(windowId)`).
- Group titles per window (existing `transport.queryGroups(windowId)`).
- `Recommendation[]` for the live tabs (existing
  `transport.getRecommendations(tabs)`).
- Recently-closed `chrome.sessions.Session[]` (new `getRecentlyClosed()`
  transport method; opt-in).

### Derived tree (pure builder, new `src/view/tree.ts`)

```ts
type TreeNode =
  | { kind: 'window'; windowId: number; focused: boolean; children: TreeNode[] }
  | { kind: 'group'; groupId: number; title: string; color?: string;
      children: TreeNode[] }
  | { kind: 'tab'; tab: TabInfo; reasons: RecommendReason[]; isDuplicate: boolean };
```

- `buildTree(windows, groupsByWindow, recsByTabId, dupKeysByTabId)` is **pure**
  and unit-testable under jsdom (no layout, like `virtualize.ts`). It walks each
  window, nests grouped tabs under group nodes (sorting siblings by
  `normalizeUrl().sortKey` via `sortTabs`), attaches `reasons` from the
  `recommendClosures` result, and marks `isDuplicate` from `dedupe`'s
  `duplicateGroups`.
- A separate **flatten step** (analogue of `renderItems`) turns the expanded
  tree into a uniform `RenderItem[]` stream for `virtualize.ts` to slice. A
  collapsed node contributes only its header row (carrying the descendant
  flagged-count), exactly like a collapsed group today.

### UI state (new reducer, `src/view/treeState.ts`)

Modeled on `view/state.ts` (pure reducer, session-only):

- `expanded: Set<string>` — node keys currently expanded (default: all live
  windows expanded, "Recently closed" collapsed). Mirrors today's `collapsed`
  set but inverted to a tree's natural default.
- `cursor` — index into the flattened visible items (reuse the
  `scrollToShow` cursor-keeping logic verbatim).
- `selection` — the node(s) a bulk op targets (window/group/tab keys).
- `filter` — substring over title/url, same predicate as `renderItems`.
- **No persisted marks.** Bulk ops act immediately through `commitClose` +
  undo; the tree does not carry a deferred "marked-to-close" set the way the
  review list does (that model belongs to the fast prune surface).

### Storage

- **Live tab/group/recommendation data:** none persisted — queried live and kept
  truthful via `transport.onTabsChanged` (debounced reconcile, the existing
  `ReviewView` pattern).
- **Recurrence counts / history:** read from the persistent records log
  (`chrome.storage.local`, `src/background/records.ts`) and `chrome.sessions`.
  No new persistent store in v1.
- **Expand/collapse + opt-ins:** session-only (lost on close), like the review
  list's collapse state, unless a later issue asks for persistence.

## UX surface

- **Where:** a dedicated extension page `outliner.html` (`chrome-extension://`
  tab), reachable from the options page and a context-menu / keyboard command.
  Architecturally identical to `review.html`; side-panel mount is a later option
  (`DESIGN.md` §3.4).
- **Layout:** header (total tabs · total flagged · window count · a "sweep all
  flagged" action) over the virtualized tree body. Each window/group is a
  collapsible header row showing its flagged count; each tab is a leaf row with
  favicon, canonical URL, title, and badges.
- **Noise at a glance:** flagged leaves get the `badge suggest` styling already
  defined for the review row; collapsed containers show `N flagged` so noise is
  countable even when collapsed. The whole point is that overload becomes a
  *number per window* you can sweep.
- **Keyboard-first**, consistent with the review list's vocabulary
  (`src/view/keymap.ts`): `j`/`k` move, `z` collapse/expand,
  `enter` jump-to-tab, `x` close subtree, a dedicated key for
  close-flagged-only, `/` filter, `u` undo, `?` help.
- **Mouse:** click a header to collapse/expand, click a leaf to jump, drag (v2).

## Open design questions, with recommended resolutions

1. **Extend `ReviewView` or build a new surface?**
   → **New surface (`OutlinerView` + `outliner.html`)** sharing the pure core,
   transport, row badges, and `virtualize.ts`. The flat-list cursor/marks model
   does not generalize cleanly to a tree, and the daily-prune list must stay
   minimal. Bridge the two with a "Review this window" affordance. (Detailed
   above.)

2. **Include historical / recently-closed tabs?**
   → **Yes, opt-in, read+restore only**, sourced from
   `chrome.sessions.getRecentlyClosed()` + the records log; a collapsed
   "Recently closed" root. A richer persistent session timeline is a *separate
   later issue*. (Detailed above.)

3. **How deep is the tree?**
   → **Two structural levels in v1: window → (group →) tab.** No arbitrary
   user-nested folders/notes (the Tabs Outliner annotation model). Chrome groups
   already give one real grouping level for free; arbitrary nesting is a large
   feature with its own persistence story — defer.

4. **Does the tree allow editing (drag/move/annotate)?**
   → **Read + collapse + bulk-close in v1; drag/move in v2; annotations are a
   non-goal.** Drag maps to `chrome.tabs.move` / `chrome.tabGroups.move` (the
   `executor.ts` primitives) but adds real complexity (drop targets, group
   integrity — note the `executor.ts` group-dissolve bug from `PLAN.md` Phase 2);
   keep it out of the first cut.

5. **How is "noise" visualized vs. the flat list's per-row badges?**
   → **Per-leaf badges (reuse `REASON_BADGES`) *and* a per-container flagged
   count.** The container count is the new, tree-specific affordance and the
   reason the tree beats the flat list for survey: noise is countable per window
   even while collapsed.

6. **What's the live-vs-snapshot reconcile strategy across many windows?**
   → **Live, debounced reconcile via `transport.onTabsChanged`**, exactly like
   `ReviewView`. The builder is pure, so re-running `buildTree` on each
   reconcile is cheap; `virtualize.ts` keeps render cost bounded regardless of
   total tab count.

7. **Where does the cross-duplicate/recurrence signal's data come from?**
   → **The records log (`getRecords`, `chrome.storage.local`).** The tree is its
   display surface, not its owner. If/when recurrence lands as a real
   `RecommendReason` in `recommend.ts`, the tree renders it with no change. Until
   then, the tree can show duplicate clusters from `dedupe`'s `duplicateGroups`
   (live, same-scope) only.

8. **Performance ceiling?**
   → **Flatten-then-virtualize**, reusing `computeWindow`/`scrollToShow`. Never
   render the whole tree; render only expanded, in-viewport nodes. This is the
   `DESIGN.md` §4 "500+ tabs" answer applied to the tree.

## Proposed minimal v1 scope

A **read-mostly, classifier-driven outline of live windows/tabs** that makes
noise countable and sweepable per window:

- Window → group → tab tree over **live tabs only** (recently-closed is opt-in
  and may slip to a follow-up).
- Per-leaf `bookmarked` / `stranded-auth` flags from `recommendClosures`, plus a
  `dup` marker from `dedupe`.
- Per-container **flagged count**.
- Operations: **collapse/expand**, **jump-to-tab**, **close subtree**,
  **close-flagged-only**, **undo** (all via the existing transport).
- Virtualized via `virtualize.ts`; keyboard-first via a keymap modeled on
  `view/keymap.ts`.
- **No drag, no annotations, no persisted history, no nested folders.**

Everything in v1 reuses existing pure core + transport; the genuinely new code
is `tree.ts` (build + flatten), `treeState.ts` (reducer), `OutlinerView.tsx`,
`outliner.html`, and one transport method for windows.

## Suggested build sub-issues

1. **`tree.ts` — pure tree builder + flattener.** `buildTree(...)` and a
   `flattenTree(expanded)` → `RenderItem[]`. No Chrome. Unit tests on nesting,
   sibling sort (via `sortTabs`), flagged-count rollup, collapsed-node
   flattening. Self-contained; can start immediately.
2. **`treeState.ts` — pure reducer.** Expand/collapse, cursor, selection,
   filter. Modeled on `view/state.ts`; fully unit-testable.
3. **Transport extension.** Add `queryWindows()` (all normal windows → ids +
   focused flag) and, behind the opt-in, `getRecentlyClosed()` wrapping
   `chrome.sessions.getRecentlyClosed`. Worker-side handlers in
   `src/background/messageHandlers.ts`.
4. **`OutlinerView.tsx` + `outliner.html` shell.** Render the flattened,
   virtualized tree; wire collapse/jump/close-subtree/close-flagged via the
   transport; reuse `Row` badges. Mirrors the `ReviewView` mount.
5. **Flagged-count rollup + "sweep flagged" actions.** Container counts and the
   close-flagged-only bulk op (routes through `commitClose` + `recordClosed`).
6. **(Opt-in) recently-closed root.** Read-only nodes from `chrome.sessions`;
   single `restore` action via the existing `chrome.sessions.restore` path.
7. **(v2) Drag/move.** `chrome.tabs.move` / `chrome.tabGroups.move` with group
   integrity guarded (heed the `executor.ts` dissolve bug, `PLAN.md` Phase 2).
8. **(v2) Recurrence signal display.** Once `9kb5` signal 3 lands in
   `recommend.ts`, surface recurrence counts from the records log on leaves.

## Non-goals

This is a **longer-horizon surface**, and the cut is deliberate:

- **Not Tabby v1.** v1 is the flat consolidate→dedup→sort→review loop
  (`DESIGN.md`); this never blocks or replaces it.
- **No arbitrary nested folders / notes / annotations.** That is the Tabs
  Outliner model with its own persistence and sync story — out of scope.
- **No new persistent session/history database.** v1 leans on `chrome.sessions`
  and the existing records log; a deep session timeline is a separate issue.
- **No drag-and-drop in v1** (v2).
- **No new classification logic.** All "interesting vs. noise" decisions stay in
  `recommend.ts` (`9kb5`); the tree only renders and operates on them.
- **No auto-close / auto-organize.** Like the rest of Tabby, every destructive
  action is user-initiated and undoable.
- **No cross-device / cloud sync.**

## Related issues

- `9kb5` — close-recommendation classifier (`docs/close-recommendation-design.md`)
  — the engine this surface renders.
- `dxph` — de-noised stash (the other classifier consumer).
- `e6f0` — records log / nav-trace (recurrence-signal + stranded-auth data source).
- `g6gb` — local, telemetry-free usage counts (a future recurrence signal source).
