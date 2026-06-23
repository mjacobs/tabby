# Review-list mouse interaction model — design notes

**Tracking issue:** kata `rxxe`
**Status:** design approved (2026-06-23). Ready to plan + build.
**Source:** an annotated screenshot of the review list calling out four mouse
behaviors (click-to-select, text-as-link, drag-area-select, hover highlight).

## The CUJ this serves: "drive the prune with the mouse, too"

Tabby's review list is keyboard-first by design (`j/k`, `x`, `Enter`, `V`) and
that stays the primary path. But the review surface is a list of rows with
checkboxes, and a mouse user's instinct there is direct manipulation: click a
row to select it, click the title to go to the page, drag a box to grab a run of
rows. Today the list does almost the opposite of that instinct, so this feature
makes the mouse model match what a list-with-checkboxes leads you to expect —
*without* disturbing the keyboard model it layers on top of.

## What it changes (and what it doesn't)

Four behaviors, all on the same row-interaction surface:

1. **Click the row body → toggle that row's close-mark.** The favicon, the
   trailing empty space, and the row padding are the select surface. The
   keyboard cursor does **not** move (a click is not a cursor move — same
   principle as the existing `toggleMarkId`, kata 49m8).
2. **Click the title or host text → switch to that tab** (`jumpTo`). Both the
   title and the grey host become hyperlinks. The host gets a traditional link
   affordance — `cursor: pointer` and an **underline on hover** (plus a shift
   toward link-blue) — as a discoverable hint that it's clickable.
3. **Hold-drag a vertical band → add every covered row to the marks**
   (ADDITIVE: existing marks are preserved; a drag is a gathering gesture). Rows
   tint as a live preview while the band crosses them and commit on release.
   Dragging into the top/bottom edge **auto-scrolls** so you can select past the
   visible viewport.
4. **Hover any row → light-blue highlight.** Purely visual; does not move the
   cursor.

This **inverts** today's model: currently a click *anywhere* on the row calls
`jumpTo`, and only the checkbox/badges toggle the mark. After this change the
row body selects and only the title/host text jumps.

**Untouched:** the entire keyboard model (`j/k/g/G`, `x/space`, `a/A`, `/`, `z`,
`Enter`, `V` visual mode, `Ctrl/⌘+Enter`, `shift+S`, `u`, `?`), the
background/transport layer, and the commit/stash/undo pipeline. Marquee marks
are ordinary entries in the same `marked` set, so they close/stash/undo with
zero new plumbing.

## Architecture

The work stays inside `src/view/` and preserves the codebase's existing split:
**pure logic in `state.ts` + small pure helpers (unit-tested without a DOM)**,
**thin view in components**, **DOM-event plumbing isolated in a hook**.

### Unified pointer model: three gestures, one surface

| Gesture | Detection | Result |
|---|---|---|
| Click row body | `mouseup` with no drag, target not a link/checkbox/badge | `toggleMarkId` (no cursor move) |
| Click title / host | `mouseup` with no drag, target is a link | `jumpTo(tab.id)` |
| Click checkbox / badge | own handler, `stopPropagation` | `toggleMarkId` (unchanged) |
| Drag | `mousemove` past a 5px threshold | live preview → `markIds` (additive) on release |

The click gestures live in `Row` as plain handlers (so they're testable with
`.click()`, like the existing badge/header tests). The drag gesture lives in a
viewport-level hook that, crucially, **suppresses the trailing click after a
drag** so a release doesn't also toggle the row under the pointer.

### Components

1. **`src/view/marquee.ts`** *(new — pure, no DOM)*
   - `rowsInBand(items, rowHeight, bandTop, bandBottom) → tabId[]` — which `row`
     items intersect a vertical pixel band. Works in **content coordinates**
     (item-index × `ROW_HEIGHT`) — the *same* coordinate model the virtualizer
     already uses (`computeWindow`/`scrollToShow`). Consequences that fall out of
     this for free: group-header items are skipped, collapsed members aren't in
     `items` so they can't be selected, and rows scrolled off-screen are still
     correctly included (which is what makes edge auto-scroll selection work).
   - `autoScrollStep(pointerY, viewportHeight, edgePx) → number` — signed px/frame
     when the pointer is within `edgePx` of the top/bottom edge, else `0`.

2. **`src/view/useMarquee.ts`** *(new — the only DOM-event code)*
   The pointer state machine: track `mousedown` origin (client x/y + scrollTop),
   promote to a drag past the 5px threshold, compute the band in content
   coordinates, run an auto-scroll `requestAnimationFrame` loop while the pointer
   sits in an edge zone, expose live `pendingIds`, and on `mouseup` commit
   `markIds(pendingIds)` (additive) and arm a one-shot capture-phase click eater
   so the drag's trailing click is swallowed. Returns
   `{ onMouseDown, band, pendingIds }`. Keeping it here stops `ReviewView` (already
   ~520 lines) from absorbing the complexity.

3. **`src/view/state.ts`** *(one new action)*
   `{ type: 'markIds'; ids: number[] }` — additive union of `ids` into `marked`.
   Pure and unit-tested. (Single-row toggles keep using `toggleMarkId`.)

4. **`src/view/Row.tsx`** *(restructured handlers)*
   - `<li>` body click → `onSelect` (toggle this row's mark).
   - `.url` host and `.title` become link elements → `onActivate` (jump), each
     `stopPropagation` so the row's select handler doesn't also fire.
   - Links are sized to their text (not stretched to fill), so the trailing row
     space stays a select target.
   - Checkbox and advisory badges unchanged (own `stopPropagation` → toggle).
   - New `isPending` prop → `pending` class for the drag preview.
   - Props change: today's `onClick` (jump) becomes `onSelect` (toggle) +
     `onActivate` (jump); add `isPending`.

5. **`src/view/ReviewView.tsx`** *(wiring only)*
   Attach `useMarquee`'s `onMouseDown` to `.list-viewport`; render the rubber-band
   overlay + pending preview; pass `onSelect` / `onActivate` / `isPending` to
   `Row`. The marquee hook receives the same `items`, `ROW_HEIGHT`, `scrollTop` /
   `setScrollTop`, viewport ref, and `dispatch` the virtualizer already computes.

6. **`src/view/review.css`** *(styling)*
   - `.row:hover` light-blue background; **marked-red and cursor-blue keep
     priority** via source order (define `:hover` before `.row.cursor` /
     `.row.marked`, equal specificity → later wins).
   - `.url` / `.title`: `cursor: pointer` + **underline on hover**; host also
     shifts toward link-blue on hover.
   - `.row.pending`: drag-preview tint (accent-tinted, distinct from committed
     red).
   - `.marquee-band`: full-width horizontal rectangle between band top/bottom,
     `pointer-events: none`.
   - `user-select: none` on the viewport while a drag is active.

### Data flow

```
drag → useMarquee (band in content px) → rowsInBand → pendingIds (live preview)
     → mouseup → dispatch(markIds) → marked set → existing commit/stash/undo
```

No background or transport changes. Selection is purely **vertical-range** based
(which rows the band's top→bottom covers); horizontal position is ignored,
because we select whole rows.

## Key decisions

- **Both title and host are links** (user choice), with the host underlined on
  hover. Trade-off accepted: a larger link area means a smaller row-body select
  target, mitigated by sizing links to their text so trailing space still
  selects.
- **Drag is additive** (user choice) — it piles rows onto the marks; it never
  unmarks. (Drag-to-unmark and replace-semantics were considered and dropped.)
- **Auto-scroll at edges** (user choice) — drag can extend the selection past the
  viewport. The content-coordinate geometry makes this fall out naturally even
  with virtualization.
- **Hover never moves the cursor** — hover and the keyboard cursor are
  independent; the blue left-bar cursor stays where `j/k`/keyboard put it. The
  screenshot's "highlight like the top row" is matched with a *lighter* hover
  blue so the real cursor still stands out.
- **Click vs drag** distinguished by a 5px movement threshold; only the left
  button (`button === 0`) starts a potential drag.

## Testing (TDD — vitest + @testing-library/preact)

- **`state.test.ts`** — `markIds` is additive and preserves existing marks; a
  no-op on already-marked ids.
- **`marquee.test.ts`** *(new)* — `rowsInBand`: full / partial / no overlap,
  header items skipped, off-screen (beyond-window) rows still included, inverted
  band (drag upward). `autoScrollStep`: inside top zone (negative), inside bottom
  zone (positive), middle (zero), clamping.
- **`ReviewView.test.tsx`** — row-body click toggles the mark (and does *not*
  jump); title click jumps; host click jumps; checkbox still toggles; a simulated
  `mousedown→mousemove(past threshold)→mouseup` produces additive marks and the
  trailing click is suppressed. jsdom-friendly because the geometry is
  `ROW_HEIGHT`-based, not real layout.

## Docs

- README "Key Features" — a short "Mouse interactions" note alongside the
  keyboard section.
- In-app `?` cheatsheet — a line noting click-to-mark / click-text-to-open /
  drag-to-select.

## Scope (YAGNI — explicitly out)

Shift-click range select, drag-to-*unmark*, per-row right-click context menus,
and any change to the keyboard model. These can be separate issues if wanted.

## Related issues

- kata `9kb5` — close-recommendation flags (the advisory badges this coexists
  with; their `stopPropagation` toggle behavior is preserved).
- kata `49m8` — "a click shouldn't move the cursor" (the precedent this extends
  from the checkbox to the whole row body).
