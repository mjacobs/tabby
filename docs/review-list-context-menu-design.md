# Review-list mouse follow-ups — design notes

**Tracking issue:** kata `rz1c` (follow-up to kata `rxxe`, closed)
**Status:** design approved (2026-06-25). Ready to build.
**Source:** user feedback after shipping the `rxxe` drag-marquee selection.

Three additions to the same review-list mouse surface `rxxe` built. They reuse
its model (a `marked` set that close/stash/undo already operate on) and its code
split: **pure logic in small helpers (unit-tested, no DOM)**, **thin
components**, **DOM-event plumbing isolated in hooks**.

## What it adds

### 1. Right-click context menu on rows

Today a right-click over the list shows Chrome's generic page menu, which has
nothing to do with Tabby. Replace it (over rows only) with a Tabby menu so a
mouse user who just rubber-band-selected a run of rows can right-click and act
without reaching for the keyboard.

- **Actions:** **Close tab(s)**, **Stash & close**, **Mark / Unmark** (label
  flips with the target's current mark state), **Jump to tab** (shown only when
  the target is a single row).
- **Target resolution (file-manager semantics):** right-clicking a row that is
  **marked** targets the **entire marked set**; right-clicking an **unmarked**
  row targets **just that one row**. The menu never silently changes the marks
  to "what you right-clicked" — it acts on the natural selection.
- **Close / Stash here are immediate** (and undoable via `u`), matching the
  meaning of those words in a menu — not "mark for later".

### 2. Per-row × close icon

A small close affordance at the far right of every row. Clicking it **closes
that one tab immediately** (the `commitClose` path, so `u` undoes it), the same
way a browser tab's own × works.

- Rendered after the badges; subtle by default (low-opacity muted ×), brightens
  on row-hover and on its own hover so it's discoverable on every row without
  adding noise to a dense list.
- `stopPropagation` on its click so it never toggles the row's mark, and it is
  added to the marquee's mousedown-exclusion list (alongside `.mark`) so a press
  on it never starts a drag.

### 3. Marquee can start in the left/right margins

The drag-marquee only *starts* inside the centered content column, because the
`mousedown` listener lives on `.list-viewport`, which sits inside the
`max-width: 960px` centered `.app`. The whitespace to the left/right of the
column looks identical but is a dead zone. Make that whitespace a valid start
target.

- **Fix (CSS-only, no JSX change):** make `.list-viewport` full-bleed
  (`width: 100vw; margin-left: calc(50% - 50vw)`) so it spans the whole window
  and catches presses in the margins, while re-centering the rows via
  `.list { max-width: 960px; margin: 0 auto; padding: 0 1rem }`. `body` gets
  `overflow-x: hidden` to absorb the `100vw`-vs-scrollbar quirk, and `.list`
  gets `position: relative` so the selection band aligns to the centered column
  rather than the full window.
- The context menu's `contextmenu` handler rides the same full-width surface.
- The marquee geometry is purely vertical (content-Y based), so a press in a
  margin selects rows by the same row-overlap math — no geometry change needed.

## Architecture

| Unit | Kind | Responsibility |
|---|---|---|
| `src/view/menu.ts` *(new)* | pure | `menuTarget(clickedId, marked) → { ids, single, targetMarked }`; `clampMenuPosition(x, y, w, h, vw, vh)` keeps the menu on-screen. |
| `src/view/useContextMenu.ts` *(new)* | hook (DOM) | Owns open-state + position + clicked tab id. `onContextMenu(e)` resolves the row under the pointer, `preventDefault`s, opens. Closes on outside-click / Escape / scroll. Mirrors `useMarquee`. |
| `ContextMenu` component | view | A `position: fixed` menu of action buttons; counts in labels ("Close 4 tabs"). |
| `src/view/Row.tsx` | view | New `row-close` `<button>`; new `onClose` prop. |
| `src/view/state.ts` | pure | New `unmarkIds` action (mirror of `markIds`) for the menu's Unmark. |
| `src/view/ReviewView.tsx` | wiring | Refactor `commit`/`stash` into reusable `closeTabs(ids)` / `stashTabs(ids)`; render `ContextMenu`; attach `onContextMenu`; pass `onClose` to `Row`. |
| `src/view/review.css` | styling | Full-bleed viewport, centered `.list`, the × button, the menu. |
| `src/view/useMarquee.ts` | hook | Add `.row-close` to the mousedown-exclusion `closest(...)`. |

### Data flow

```
right-click row → useContextMenu (clicked tab id, x, y) → menuTarget(id, marked)
  → ContextMenu renders actions → Close/Stash → closeTabs/stashTabs(target.ids)
                                → Mark/Unmark → dispatch(markIds | unmarkIds)
                                → Jump        → transport.jumpTo(id)

× click → onClose(tab.id) → closeTabs([id]) → commitClose → removeTabs → undoable
```

No background/transport changes: every action reuses an existing transport call
(`commitClose`, `stashClose`, `jumpTo`) and the existing `marked`-set pipeline.

## Testing (TDD — vitest + @testing-library/preact)

- **`menu.test.ts`** *(new)* — `menuTarget`: marked row → all marked, with
  `single` reflecting count and `targetMarked: true`; unmarked row → `[id]`,
  `single: true`, `targetMarked: false`. `clampMenuPosition`: flips off the
  right/bottom edges, leaves an in-bounds point untouched.
- **`state.test.ts`** — `unmarkIds` removes the given ids, leaves others, no-op
  on already-unmarked / empty.
- **`ReviewView.test.tsx`** — right-click an unmarked row → Close closes just
  that tab; right-click a marked row → Close closes the whole marked set; ×
  closes a single tab without toggling its mark or jumping; the menu's Jump
  appears only for a single-row target and calls `jumpTo`; opening the menu
  `preventDefault`s the contextmenu event.
- The existing `rxxe` marquee + keyboard tests must stay green.

## Docs

- README "Mouse Interactions" — note right-click menu, per-row ×.
- In-app `?` cheatsheet — extend the mouse line.

## Scope (YAGNI — explicitly out)

Full keyboard navigation inside the menu (arrow keys / type-ahead), submenus,
drag-to-*unmark*, and a context menu over non-row whitespace.
