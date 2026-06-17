# De-noised tab stash (OneTab done right) — design notes

**Tracking issue:** kata `dxph` (design spike)
**Status:** design draft (2026-06-17). Scope + storage decision proposed below;
this doc is the starting point for a future implementer.
**Sibling that may land in parallel:** kata `2by6` (stash *reviewed* tabs to a
"Tabby Stash" bookmark folder). This doc positions `dxph` as the broader
**de-noised bulk-park** surface and calls out the shared mechanism with `2by6`
so the two converge rather than diverge — see "Relationship to siblings".

This builds directly on the `9kb5` close-recommendation classifier
(`docs/close-recommendation-design.md`) and the existing dedup/normalize
primitives. It reuses real modules by name throughout so an implementer can
start from the wiring, not from scratch.

---

## 1. The CUJ: "bulk-park the pile, keep the stash valuable"

The de-noised stash serves the same recurring journey as the rest of Tabby —
the "tab overload → grounded state" loop the user hits several times a day
(`docs/close-recommendation-design.md` §"The CUJ this serves"). The existing
pipeline (consolidate → dedup → sort → review) is the *deliberate* path: you
review and prune. The stash is the **escape-hatch** path for the moment when
you don't have the attention to review at all:

> "I have 80 tabs, I can't even see what I have, and I need a clean window
> *now* — but I'm not ready to admit any of these tabs are gone forever."

The bulk-park action answers that in one keystroke: move the whole window (or a
selection) into a saved list and clear the window. The window is grounded
instantly; nothing is lost; you can come back to the list later.

The catch — and the entire bet of this feature — is the second half: **a stash
is only as valuable as it is de-noised.** A list you never revisit is just a
slower delete.

---

## 2. Prior art: OneTab and its failure mode

OneTab is the reference implementation of the blunt move, and the user has
lived with it (`docs/close-recommendation-design.md` §"Prior art"). Its
strength is real: **one button dumps every tab into a saved list and clears the
window.** It is genuinely effective at "get the noise off my radar *now*."

Its failure mode is equally real, and it's the gap this feature targets:

- **The saved list inherits *all* the noise.** Everything that was open gets
  parked verbatim — `google.com`, dozens of repeated `google.com/search?q=…`,
  many `Inbox (155)` Gmail entries, duplicated dashboards, stranded login
  pages. The OneTab-export evidence in the `9kb5` doc (`~/tmp/one_tab_export_
  example_links.txt`) is exactly this: `Inbox (155)` repeated ~6×,
  Proxmox/NPM/Miniflux recurring across dumps, dozens of Google searches,
  stranded `chase.com/logout` and `.../login` entries.
- **So the list is rarely revisited.** Because 80% of it is noise, scanning it
  is hopeless; in practice it's only ever **ctrl-F searchable** — you go back
  for one specific page you half-remember, never to browse the stash as a
  resource.

The other tools in the space (Tabs Outliner / Link Map — see sibling `3ce9`)
have the inverse problem: they show *everything* in a tree but make you clear
the noise by hand.

**Lesson, stated as the bet:** the same classifier that recommends closing live
tabs (`9kb5`) should also clean what lands in any saved list. De-noise *on the
way in*, and the stash becomes a list worth scanning, not just grepping.

---

## 3. How it reuses the `9kb5` classifier

The whole point of `dxph` is that the de-noising primitives already exist and
are pure (no Chrome APIs), so they run unchanged on the bulk-park path. Three
real modules do the work:

### 3.1 `core/dedupe.ts` — collapse exact recurrence

`dedupe(tabs, settings)` (`src/core/dedupe.ts`) already groups tabs by
**normalized URL** and returns `{ keep, close, duplicateGroups }`. On the
stash path we run it over the parked set and keep only the `keep` survivors,
so the "Inbox (155) ×6", "same dashboard ×4" duplication collapses to one entry
per normalized URL before anything is written. This is the cheapest, highest-
precision de-noise step and it's free — it's the exact function the live
pipeline uses (DESIGN §2.3).

Note `dedupe` also resolves a per-tab **mode** (`resolveMode`): `purge` for
blank/new-tab pages, `protect` for `browser`/`extension`/`file`/`other`. On the
stash path we lean on the same `classifyUrl` (`src/core/urlCategory.ts`)
classification — there is no reason to park `about:blank`, `chrome://…`, or the
Tabby review page itself.

### 3.2 `core/normalizeUrl.ts` — the comparison key

`normalizeUrl(rawUrl, settings.normalize)` (`src/core/normalizeUrl.ts`) is the
canonicalizer both `dedupe` and the recommender lean on. It produces:

- `normalized` — the dedup/equality key (used to collapse §3.1 and to match
  against bookmarks §3.3 and the cross-stash signal §3.4);
- `sortKey` — `host → path → query`, used by `sortTabs` to cluster same-site
  entries adjacently so the stash list is scannable, not random.

Normalization stays **comparison-only**: the stash stores each tab's *real*
URL (so restore is faithful), and uses the normalized form only as a key. This
mirrors the existing invariant exactly.

### 3.3 `core/recommend.ts` — drop dead logins (and bookmarked redundancy)

`recommendClosures(tabs, ctx)` (`src/core/recommend.ts`) is the `9kb5`
classifier proper. On the stash path it runs over the parked set to flag the
*uninteresting* entries:

- `isStrandedAuthUrl(rawUrl)` — the stranded login/logout/challenge matcher
  (`AUTH_PATH_SEGMENTS`, `AUTH_HOST_PREFIXES`, the `accounts.google.com`
  `AUTH_HOST_PATHS` entry, and the `/auth?redirect=…` bounce-back shape). A tab
  sitting on a dead login page held nothing worth keeping — `chase.com/logout`,
  `login.brev.nvidia.com/signin`, etc. from the export evidence.
- the `bookmarked` reason — `recommendClosures` already matches each tab's
  `normalizeUrl(...).normalized` against `ctx.bookmarkedUrls`. A page that's
  already bookmarked doesn't need to be stashed too; it's noise in the list.

The worker assembles `ctx.bookmarkedUrls` exactly as the live path does, via
`getBookmarkedUrlSet(settings.normalize)` (`src/background/bookmarks.ts`), which
walks `chrome.bookmarks.getTree()` and normalizes each URL with the same
options. The handler `getRecommendations` in
`src/background/messageHandlers.ts` is the template — the stash worker does the
same assembly.

**Drop vs. fold (default: fold).** A `Recommendation` is *advisory* in the live
review — never auto-close. On the stash path the same flags drive a de-noise
**policy** instead. Recommended default (precision-first, see §6.Q2): **fold,
don't silently drop.** Flagged entries are still written to the stash but to a
collapsed **"Noise (N hidden)"** sub-section, out of the main scannable list and
restorable on expand. This keeps the "never lose a tab" invariant that the rest
of Tabby holds (DESIGN §2.6 undo, §1 goals) while still giving the user a
de-noised *default view*. A per-policy "drop entirely" mode is available but
opt-in.

### 3.4 Cross-stash recurrence — the `9kb5` signal 3, realized

`9kb5` describes a **cross-duplicate signal** (signal 3): a URL you keep
re-opening across sessions and never act on is ambient background, not a task —
the `Inbox (155) ×6` pattern. In the live recommender that signal needs the
records/history store to count recurrences over time. **The stash is the
natural home for it**, because the stash list *is* a persistent history of what
the user parked. Concretely:

- Each stash entry carries a normalized URL (§3.2) and a `seenCount`.
- When the same `normalized` URL is parked again, we bump `seenCount` on the
  existing entry rather than appending a duplicate.
- An entry whose `seenCount` crosses a threshold (recommended: ≥ 3, see §6.Q4)
  is treated as recurrence-noise and folded into the same collapsed section as
  §3.3 — with reason `cross-stash`.

This is the one signal `dxph` *adds* on top of the shared classifier, and it
adds it cheaply: it's just a counter on the storage key the stash already needs.
It should be implemented as a pure helper (proposed `core/stash.ts`,
`foldStashNoise(entries, opts)`) so it's unit-testable like the rest of `core/`.

### 3.5 `core/sortTabs.ts` — make the list scannable

After de-noise, the surviving entries are ordered with the same `sortKey` logic
`sortTabs` (`src/core/sortTabs.ts`) uses for the live strip — host → path →
query — so same-site entries cluster. A scannable order is half of what makes a
stash worth revisiting (the other half is having removed the noise).

---

## 4. Data + storage model

### 4.1 The shape (pure types)

A stash is a named, timestamped collection of parked entries. Proposed types
live in `src/shared/types.ts` (kept Chrome-free so `core/` stays pure, matching
the existing convention):

```ts
/** One parked tab. Stores the REAL url for faithful restore; normalized is the key. */
export interface StashEntry {
  url: string;            // real URL — restore target
  normalized: string;     // normalizeUrl(...).normalized — dedup + recurrence key
  title: string;
  favIconUrl?: string;
  parkedAt: number;       // ms epoch first parked
  seenCount: number;      // §3.4 cross-stash recurrence (starts at 1)
  /** Why this entry is in the collapsed "noise" section, if it is. */
  noiseReasons?: Array<'bookmarked' | 'stranded-auth' | 'cross-stash'>;
}

/** A bulk-park snapshot. */
export interface Stash {
  id: string;             // uuid
  name: string;           // default: "Stashed <date> <time>" — user-renamable
  createdAt: number;
  entries: StashEntry[];
}
```

`StashEntry.noiseReasons` deliberately mirrors `RecommendReason` from
`core/recommend.ts` plus the `cross-stash` addition, so the de-noise pass maps a
`Recommendation` straight onto an entry.

### 4.2 Where it lives — `chrome.storage.local` vs. a bookmark folder

This is the central storage decision; the kata body and `2by6` both call for
weighing it.

**Option A — `chrome.storage.local`.** A `tabby:stashes` key holding
`Stash[]`, exactly like the existing records log
(`src/background/records.ts`, `RECORDS_KEY = 'tabby:records'`, capped via the
pure `appendCapped`). Pros: a rich schema (`seenCount`, `noiseReasons`,
per-stash name, the collapsed noise section) — none of which a bookmark folder
can represent; full control over de-noise structure; no permission beyond
`storage` (already granted, DESIGN §3.1). Cons: it's a private store the user
can't see or sync via the browser's own bookmark UI; it's local-only (no sync).

**Option B — a "Tabby Stash" bookmark folder.** Each stash is a sub-folder of
bookmarks; each entry is a bookmark. Pros: visible and editable in the native
bookmark manager; rides Chrome bookmark sync for free; this is exactly what
sibling `2by6` proposes. Cons: a bookmark is just `{title, url}` — there is
**nowhere to put** `seenCount`, `noiseReasons`, the collapsed-noise structure,
or the de-noise metadata that is the whole point of `dxph`. Requires the
`bookmarks` permission with write scope (read is already used by
`bookmarks.ts`). Folders are flat-ish and clumsy for "restore this whole stash".

**Recommended: `chrome.storage.local` as the source of truth (Option A), with
an *optional* bookmark-folder mirror for the de-noised survivors (Option B as
an export).** Rationale:

- The de-noise structure (`seenCount`, the noise section, recurrence) is the
  feature; it cannot live in bookmarks, so the primary store must be
  `storage.local`.
- The bookmark folder is still valuable as a *durable, syncable, user-visible*
  copy — but it should receive only the **de-noised main list**, never the
  collapsed noise. That is precisely the convergence point with `2by6`: `2by6`'s
  "send reviewed tabs to a Tabby Stash bookmark folder" becomes the **export
  sink** of `dxph`'s de-noise pass, so a user gets the same clean folder whether
  they arrived via bulk-park or via review-then-stash.

Cap the local store the way records are capped (`appendCapped` pattern) — e.g.
keep the N most-recent stashes, oldest dropped — to bound `storage.local`.

### 4.3 Restore

Restore reuses the machinery the undo path already established
(`src/background/undo.ts`): write each entry's `url`/`title`/`pinned` back as a
tab. `undo.ts` already does best-effort `chrome.sessions.restore` (to bring back
history) with a fallback to recreating the URL; stash restore can reuse the same
fallback (recreate the URL) — `chrome.sessions` entries will have long expired
for an old stash, so URL-recreate is the realistic path. Restore granularity:
whole stash, or per-entry (a checkbox list, see §5).

---

## 5. UX surface

### 5.1 The bulk-park action

- **Trigger.** A new command/affordance distinct from the cleanup trigger.
  Options: a toolbar-action context-menu item ("Stash this window"), a
  `chrome.commands` shortcut, or a button on the review page header. Recommended
  v1: **a button in the existing review-page header** ("Stash all → clear
  window"), since the review page already has the consolidated tab set in hand
  and the header already hosts `Undo`/`Done` controls (DESIGN §2.5). This avoids
  a new top-level surface for v1.
- **Scope.** Whole window (default) or current selection. The review view
  already tracks a marks/selection set in `view/state.ts`; "stash the marked
  rows" reuses that selection model directly (same set that drives close).
- **Action.** Snapshot the in-scope tabs → run the de-noise pass (§3) → write a
  `Stash` → close the parked tabs (recorded in the existing undo buffer, so a
  fat-fingered bulk-park is itself undoable) → toast "Parked 62 tabs (18 noise
  folded) → Stash 'Stashed Jun 17'".

### 5.2 The stash list (searchable / restorable)

A list surface to browse and restore stashes. Recommended v1 home: **extend the
existing records page** rather than build a third page. There is already a
records page reading `getRecords` (`src/background/records.ts` +
`messageHandlers.ts`); a "Stashes" tab/section beside it keeps the surface count
down. Each stash renders as:

```
▸ Stashed Jun 17 · 44 kept · 18 noise · [Restore all] [Delete]
    github.com/mjacobs/tabby/issues/1   "Issue: dedup"          [↺]
    news.ycombinator.com/item?id=123    "Show HN: …"            [↺]
    …
  ▸ Noise (18 hidden) — bookmarked, stranded-auth, recurring     [show]
```

- **Search.** Reuse the review view's `/` substring filter behavior over
  title+URL (`view/keymap.ts`, `view/state.ts`) — same UX the user already
  knows. This deliberately keeps the OneTab "ctrl-F" affordance the user relies
  on, but over an *already de-noised* list.
- **Restore.** `[Restore all]` per stash, `[↺]` per entry. Restored entries can
  optionally be removed from the stash (a setting; default keep, so a stash is
  a re-usable resource not a one-shot).
- **The noise section** is collapsed by default and expandable, honoring "never
  lose a tab."

### 5.3 Message contract

Add request types to the existing typed contract in `src/shared/messages.ts`
(`ViewRequest`/`ViewResponse`), dispatched in
`src/background/messageHandlers.ts` exactly like `getRecommendations`/
`getRecords` are today:

- `{ type: 'stashTabs'; tabs: TabInfo[] }` → `{ stashId: string; kept: number; folded: number }`
- `{ type: 'getStashes' }` → `{ stashes: Stash[] }`
- `{ type: 'restoreStash'; stashId: string; entryUrls?: string[] }` → `{ restored: number }`
- `{ type: 'deleteStash'; stashId: string }` → `{ ok: boolean }`

The de-noise itself happens worker-side in the `stashTabs` handler (it needs
`chrome.bookmarks` for `getBookmarkedUrlSet`), reusing `recommendClosures` +
`dedupe` + the new `foldStashNoise` pure helper.

---

## 6. Open design questions (with recommended resolutions)

### Q1. Whole-window only, or selection too?

**Recommended: support both, lead with whole-window.** Whole-window is the
OneTab parity move and the primary CUJ. Selection is nearly free because the
review view's marks set (`view/state.ts`) already exists — "stash the marked
rows" is the same selection that drives "close the marked rows." Ship whole-
window in v1; selection is a small follow-on if not free.

### Q2. De-noise = drop, or fold-and-hide?

**Recommended: fold-and-hide (collapsed "Noise" section), drop is opt-in.**
Silently dropping tabs violates Tabby's load-bearing "never lose a tab" goal
(DESIGN §1, §2.6). Folding gives the de-noised *default view* (the actual
value) without throwing anything away. A power-user "drop entirely" policy can
exist behind a setting, but it must not be the default.

### Q3. Storage: `storage.local` vs. bookmark folder?

**Recommended: `storage.local` is the source of truth; optional bookmark-folder
mirror of the de-noised survivors** (see §4.2). The de-noise metadata can't live
in bookmarks, so it must be local; the bookmark mirror is the convergence sink
shared with `2by6`.

### Q4. Cross-stash recurrence threshold?

**Recommended: fold at `seenCount ≥ 3`, no time decay in v1.** Three parkings of
the same normalized URL is a strong "ambient, not a task" signal and matches the
export evidence (Inbox ×6, etc.). Decay (recency-weighted recurrence) is a
plausible v2 refinement but adds tuning surface for marginal gain; defer it.
Make the threshold a constant in `core/stash.ts` so it's trivially adjustable
and unit-tested.

### Q5. Does restore remove the entry from the stash?

**Recommended: no — default keep.** A stash is a resource you can pull from
repeatedly, not a one-shot outbox. Expose "remove on restore" as a per-restore
modifier / setting for users who want outbox semantics.

### Q6. Should the bulk-park run the full consolidate-first pipeline?

**Recommended: no for v1 — stash the current window's tabs as-is.** Consolidate
moves tabs across windows (DESIGN §2.2) and is a heavier operation with its own
edge cases (pinned-in-other-windows, group integrity — see PLAN Phase 2). v1
bulk-park operates on the already-consolidated review set (it lives on the
review page) or the current window. Cross-window bulk-park can come later.

### Q7. Pinned tabs and tab groups?

**Recommended: never stash pinned tabs; preserve group label as metadata only.**
Pinned tabs are anchored by the user (the dedup/recommend code already skips
them — `recommendClosures` skips `tab.pinned`, `dedupe.resolveMode` protects
them). The stash should likewise leave pinned tabs in place. Tab-group
membership can be recorded on `StashEntry` (a `groupLabel?` field) for display,
but v1 restore does not need to reconstruct groups.

### Q8. What about the active tab?

**Recommended: never stash the active tab** — consistent with the active-tab
invariant everywhere else in Tabby (`dedupe`, `recommendClosures` both skip
`tab.active`). Clearing the window leaves the user looking at *something*.

---

## 7. Proposed minimal v1 scope

The smallest thing that delivers the bet ("a de-noised stash that's worth
revisiting"):

1. **Bulk-park whole window** from a button in the review-page header → writes a
   `Stash` to `chrome.storage.local`, closes parked tabs (recorded in the
   existing undo buffer).
2. **De-noise on the way in**, reusing the real modules:
   - `dedupe` (collapse exact recurrence),
   - `recommendClosures` + `isStrandedAuthUrl` + `getBookmarkedUrlSet` (fold
     dead logins and already-bookmarked entries),
   - cross-stash `seenCount` recurrence fold (the one new pure helper,
     `core/stash.ts`),
   - `sortTabs` ordering for scannability,
   - flagged entries **folded** into a collapsed "Noise" section, not dropped.
3. **Stash list surface** as a section on the existing records page: list
   stashes, `/`-search, expand the noise section, restore-all and per-entry
   restore, delete.
4. **Restore** via the existing `undo.ts` URL-recreate fallback.

Explicitly **out of v1:** cross-window consolidate-before-stash (Q6),
selection-scoped park (Q1, fast-follow), the bookmark-folder mirror / `2by6`
export sink (Q3 — designed-for but second), drop-instead-of-fold policy (Q2),
recurrence decay (Q4), group reconstruction on restore (Q7).

---

## 8. Suggested build sub-issues

1. **`core/stash.ts` — pure de-noise + types.** `StashEntry`/`Stash` types in
   `shared/types.ts`; `foldStashNoise(entries, ctx)` mapping `Recommendation`s +
   `seenCount` → kept vs. folded; `mergeRecurrence(existing, incoming)` bumping
   `seenCount` on matching normalized URLs. Vitest tables like the rest of
   `core/` (mirrors how `dedupe`/`recommend` are tested).
2. **`background/stashStore.ts` — storage glue.** `chrome.storage.local`
   read/write of `tabby:stashes`, capped via the existing `appendCapped` pattern
   from `records.ts`. `createStash`, `getStashes`, `deleteStash`,
   `mergeRecurrenceAcrossStashes`.
3. **`stashTabs` worker handler.** New `ViewRequest`/`ViewResponse` entries in
   `shared/messages.ts`; handler in `messageHandlers.ts` that assembles
   `bookmarkedUrls` (via `getBookmarkedUrlSet`), runs `dedupe` →
   `recommendClosures` → `foldStashNoise` → `sortTabs`, writes the stash, and
   closes the parked tabs (recording undo + a `records.ts` entry).
4. **Review-page "Stash all → clear window" button.** Header control in the
   review view; calls `stashTabs` with the current review tab set; toast with
   kept/folded counts.
5. **Stash list section on the records page.** Render stashes, `/`-filter
   (reuse `view/state.ts`/`keymap.ts`), collapsed noise section, restore/delete
   wired to `getStashes`/`restoreStash`/`deleteStash`.
6. **Restore path.** `restoreStash` handler reusing `undo.ts`'s URL-recreate
   fallback; whole-stash and per-entry.
7. **(Post-v1) Bookmark-folder mirror — the `2by6` convergence.** Export the
   de-noised survivors of a stash to a "Tabby Stash/<name>" bookmark folder,
   writing via `chrome.bookmarks`. Shared sink so `2by6`'s review-then-stash and
   `dxph`'s bulk-park produce the same clean folder.

---

## 9. Non-goals

- **No silent deletion.** De-noise folds, it never drops by default (Q2). Every
  parked tab is recoverable, consistent with Tabby's "never lose a tab silently"
  goal (DESIGN §1).
- **No cloud / cross-device sync of the rich stash store** in v1. Sync, if
  wanted, comes only via the optional bookmark-folder mirror (which rides
  Chrome's own bookmark sync) — not by syncing `storage.local`.
- **No ML / topic clustering** of stash contents. De-noise is the existing
  rule-based classifier (`9kb5`) plus exact-URL recurrence — nothing learned,
  matching DESIGN §1 non-goals and `9kb5`'s "small set of high-precision signals
  beats a clever scorer."
- **Not a tree/outliner.** Whole-picture tree manipulation of open + historical
  tabs is sibling `3ce9`; `dxph` is a flat, de-noised, restorable list.
- **No auto-stashing / scheduled parking.** Bulk-park is always user-initiated,
  matching DESIGN's "cleanup is always user-initiated" non-goal.
- **No group reconstruction on restore** in v1 (Q7); group labels are display
  metadata only.
- **Not a replacement for the review/close flow.** The stash is the
  escape-hatch for "park it all now"; the review pipeline remains the deliberate
  prune path. They share the classifier, not the surface.

---

## Relationship to siblings

- **`2by6` (stash reviewed tabs → "Tabby Stash" bookmark folder)** — may land in
  parallel. This doc treats `2by6` as the **narrower** path (send a reviewed
  selection to a bookmark folder) and `dxph` as the **broader de-noised
  bulk-park** surface. Convergence is deliberate: the de-noise pass (§3) is the
  shared mechanism, and the bookmark-folder write (`2by6`) becomes `dxph`'s
  optional **export sink** (§4.2, sub-issue 7). Build them so the de-noise step
  is one pure module both call, and the bookmark-folder writer is one worker
  helper both call — so they converge on a single clean folder rather than two
  divergent stash implementations.
- **`9kb5` (close-recommendation classifier)** — the source of the de-noise
  signals. `dxph` consumes `recommendClosures`/`isStrandedAuthUrl` and realizes
  `9kb5`'s deferred **cross-duplicate signal (signal 3)** as the cross-stash
  `seenCount` (§3.4). Not blocked by `9kb5` but best built on top of it (the
  classifier already exists in `core/recommend.ts`).
- **`3ce9` (tree/outliner view)** — the other classifier consumer. Sibling, not
  overlapping: `3ce9` is whole-picture tree manipulation; `dxph` is a flat
  de-noised list. They could later share the stash store as a source of
  historical/closed tabs.

## Related issues

- `9kb5` — interesting-to-close classifier (`docs/close-recommendation-design.md`)
- `2by6` — named sessions / stash reviewed tabs (bookmark folder)
- `3ce9` — tree/outliner view
- `e6f0` — records log (storage + cap pattern this reuses)
