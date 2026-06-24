# Review-list mouse interactions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mouse interaction layer to the keyboard-driven review list: click row body to toggle its close-mark, click the title/host text to switch to that tab, hold-drag a vertical band to additively mark rows (live preview + edge auto-scroll), and hover-highlight rows.

**Architecture:** All changes live in `src/view/`. Pure logic goes in `state.ts` (one new reducer action) and a new pure `marquee.ts` (geometry, no DOM). DOM-event plumbing is isolated in a new `useMarquee.ts` hook. `Row.tsx` restructures its handlers; `ReviewView.tsx` wires everything; `review.css` styles it. No background/transport/manifest/permission changes.

**Tech Stack:** Preact + hooks, TypeScript, vitest + @testing-library/preact (jsdom). Path alias `@/` → `src/`.

**Design doc:** `docs/review-list-mouse-design.md` (kata `rxxe`).

## Global Constraints

- Keyboard model is untouched: `j/k/g/G`, `x/space`, `a/A`, `/`, `z`, `Enter`, `V`, `Ctrl/⌘+Enter`, `shift+S`, `u`, `?`, `Esc`.
- A mouse click never moves the keyboard cursor (precedent: `toggleMarkId`, kata 49m8).
- Marquee marks land in the same `marked: Set<number>` used by commit/stash/undo — no new mark storage.
- Row height is the constant `ROW_HEIGHT = 28` in `ReviewView.tsx`, mirrored by `--row-h` in `review.css`; all marquee geometry is in content coordinates (item-index × `ROW_HEIGHT`).
- `RenderItem` type (from `src/view/renderItems.ts`): `{ kind: 'header'; groupId: number } | { kind: 'row'; tab: TabInfo; index: number }`.
- Commit messages: conventional style with the kata ref, e.g. `feat(rxxe): …`, and the repo's Co-Authored-By / Claude-Session trailers.
- Run `pnpm test` (vitest) and `pnpm typecheck` to verify.

---

### Task 1: `markIds` additive reducer action

**Files:**
- Modify: `src/view/state.ts` (Action union ~line 29-45; `reduce` switch)
- Test: `test/view/state.test.ts`

**Interfaces:**
- Produces: action `{ type: 'markIds'; ids: number[] }` — unions `ids` into `state.marked` (additive; never unmarks). Empty `ids` is a no-op (returns same state reference).

- [ ] **Step 1: Write the failing test** — append inside `describe('review state', …)` in `test/view/state.test.ts`:

```ts
it('markIds adds ids additively and preserves existing marks (no cursor move)', () => {
  let s = load('a', 'b', 'c', 'd');
  s = reduce(s, { type: 'toggleMarkId', id: 1 }); // pre-existing mark
  s = reduce(s, { type: 'markIds', ids: [2, 3] });
  expect([...s.marked].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  expect(s.cursor).toBe(0);
  // Re-marking an already-marked id is a no-op (never toggles off).
  s = reduce(s, { type: 'markIds', ids: [2] });
  expect([...s.marked].sort((a, b) => a - b)).toEqual([1, 2, 3]);
});

it('markIds with no ids is a no-op returning the same state', () => {
  const s = load('a', 'b');
  expect(reduce(s, { type: 'markIds', ids: [] })).toBe(s);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- state.test`
Expected: FAIL — TS/type error or `markIds` not handled.

- [ ] **Step 3: Add the action type** — in the `Action` union in `src/view/state.ts`, add after the `toggleMarkId` line:

```ts
  | { type: 'markIds'; ids: number[] }
```

- [ ] **Step 4: Handle it in `reduce`** — add a case after the `toggleMarkId` case:

```ts
    case 'markIds': {
      // Additive union used by the drag-marquee commit: mark every id in the
      // band, keep existing marks, never toggle off. No cursor move (mouse path).
      if (action.ids.length === 0) return state;
      const marked = new Set(state.marked);
      for (const id of action.ids) marked.add(id);
      return { ...state, marked };
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- state.test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/view/state.ts test/view/state.test.ts
git commit -m "feat(rxxe): add markIds additive reducer action"
```

---

### Task 2: `marquee.ts` pure geometry helpers

**Files:**
- Create: `src/view/marquee.ts`
- Test: `test/view/marquee.test.ts`

**Interfaces:**
- Consumes: `RenderItem` from `@/view/renderItems`.
- Produces:
  - `rowsInBand(items: RenderItem[], rowHeight: number, bandA: number, bandB: number): number[]` — tab ids of `row` items whose vertical span `[i*rowHeight, (i+1)*rowHeight)` intersects the band `[min(bandA,bandB), max(bandA,bandB)]`. Header items are skipped. Order follows `items`.
  - `autoScrollStep(pointerY: number, viewportHeight: number, edge: number, maxStep?: number): number` — signed px/frame; negative within `edge` of the top, positive within `edge` of the bottom, else `0`. `maxStep` defaults to `16`.

- [ ] **Step 1: Write the failing test** — create `test/view/marquee.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { rowsInBand, autoScrollStep } from '@/view/marquee';
import type { RenderItem } from '@/view/renderItems';
import { tab } from '../helpers';

const H = 28;

// items: row0(id1), row1(id2), header, row3(id3), row4(id4)
const items: RenderItem[] = [
  { kind: 'row', tab: tab({ id: 1 }), index: 0 },
  { kind: 'row', tab: tab({ id: 2 }), index: 1 },
  { kind: 'header', groupId: 7 },
  { kind: 'row', tab: tab({ id: 3 }), index: 2 },
  { kind: 'row', tab: tab({ id: 4 }), index: 3 },
];

describe('rowsInBand', () => {
  it('returns rows whose span intersects the band; skips headers', () => {
    // Band 10..70 covers content rows at 0-28, 28-56, 56-84 → indices 0,1,2.
    // Item index 2 is the header (skipped); the row at item index 3 (id 3) is
    // the one at content 84-112 — not covered. So ids 1 and 2.
    expect(rowsInBand(items, H, 10, 70)).toEqual([1, 2]);
  });

  it('is direction-agnostic (drag upward)', () => {
    expect(rowsInBand(items, H, 70, 10)).toEqual([1, 2]);
  });

  it('includes a row only when it actually overlaps (no zero-width touch)', () => {
    // Band exactly 0..28 overlaps only the first row.
    expect(rowsInBand(items, H, 0, 28)).toEqual([1]);
  });

  it('includes rows far down the list (beyond a viewport), enabling auto-scroll', () => {
    // Content y 84..140 spans the header row slot (84-112, item idx 3 = id 3)
    // and the next (112-140, item idx 4 = id 4).
    expect(rowsInBand(items, H, 84, 140)).toEqual([3, 4]);
  });

  it('returns empty when the band covers no row', () => {
    expect(rowsInBand([{ kind: 'header', groupId: 7 }], H, 0, 28)).toEqual([]);
  });
});

describe('autoScrollStep', () => {
  it('scrolls up (negative) inside the top edge zone', () => {
    expect(autoScrollStep(5, 600, 40)).toBeLessThan(0);
  });
  it('scrolls down (positive) inside the bottom edge zone', () => {
    expect(autoScrollStep(595, 600, 40)).toBeGreaterThan(0);
  });
  it('does not scroll in the middle', () => {
    expect(autoScrollStep(300, 600, 40)).toBe(0);
  });
  it('scrolls faster nearer the edge', () => {
    expect(Math.abs(autoScrollStep(1, 600, 40))).toBeGreaterThan(
      Math.abs(autoScrollStep(35, 600, 40)),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- marquee.test`
Expected: FAIL — `@/view/marquee` not found.

- [ ] **Step 3: Implement `src/view/marquee.ts`**

```ts
// Pure geometry for the drag-marquee selection. No DOM: works in the same
// content-coordinate model the virtualizer uses (item index × rowHeight), so it
// naturally handles off-screen rows (edge auto-scroll) and skips group headers.

import type { RenderItem } from '@/view/renderItems';

/**
 * Tab ids of the `row` items whose vertical span [i*rowHeight, (i+1)*rowHeight)
 * intersects the band between `bandA` and `bandB` (either order). Header items
 * are skipped — only rows can be marked.
 */
export function rowsInBand(
  items: RenderItem[],
  rowHeight: number,
  bandA: number,
  bandB: number,
): number[] {
  const lo = Math.min(bandA, bandB);
  const hi = Math.max(bandA, bandB);
  const ids: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== 'row') continue;
    const top = i * rowHeight;
    const bottom = top + rowHeight;
    // Half-open overlap: a band that only touches a row's bottom edge (hi===top)
    // doesn't select it, matching the "covers the row" intuition.
    if (bottom > lo && top < hi) ids.push(item.tab.id);
  }
  return ids;
}

/**
 * Auto-scroll velocity (px/frame) when a drag holds the pointer near a viewport
 * edge: negative inside `edge` px of the top, positive inside `edge` px of the
 * bottom, scaled by how deep into the zone the pointer is, else 0.
 */
export function autoScrollStep(
  pointerY: number,
  viewportHeight: number,
  edge: number,
  maxStep = 16,
): number {
  if (edge <= 0 || viewportHeight <= 0) return 0;
  if (pointerY < edge) {
    const intensity = Math.min(1, (edge - pointerY) / edge);
    return -Math.ceil(intensity * maxStep);
  }
  if (pointerY > viewportHeight - edge) {
    const intensity = Math.min(1, (pointerY - (viewportHeight - edge)) / edge);
    return Math.ceil(intensity * maxStep);
  }
  return 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- marquee.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/view/marquee.ts test/view/marquee.test.ts
git commit -m "feat(rxxe): add pure marquee geometry helpers"
```

---

### Task 3: Row click model — body selects, title/host are links

**Files:**
- Modify: `src/view/Row.tsx` (whole component)
- Modify: `src/view/ReviewView.tsx` (the `<Row …>` render, ~lines 434-442)
- Modify: `src/view/review.css` (rows / links / hover)
- Test: `test/view/ReviewView.test.tsx`

**Interfaces:**
- Consumes: `transport.jumpTo`, `dispatch({ type: 'toggleMarkId', id })` (both already exist).
- Produces (new `Row` props): `onActivate: () => void` (jump to tab — title/host link), `onToggle: () => void` (toggle this row's mark — row body, checkbox, badge), `isPending?: boolean` (drag-preview tint). Removes the old `onClick` prop.

- [ ] **Step 1: Write the failing tests** — in `test/view/ReviewView.test.tsx`, replace the existing `it('jumps to a tab on Enter without a modifier', …)` test's siblings by ADDING these tests inside the `describe('ReviewView', …)` block (keep all existing tests):

```ts
it('clicking the row body toggles the mark and does not jump (kata rxxe)', async () => {
  const { transport, calls } = makeTransport([
    tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
    tab({ id: 2, url: 'https://b.com', title: 'Beta' }),
  ]);
  const { container } = render(<ReviewView transport={transport} />);
  await screen.findByText('Alpha');

  // Click the row <li> body (not a link): toggles the mark, never jumps.
  const row = container.querySelector('.row') as HTMLElement;
  row.click();
  await screen.findByText('Close 1');
  expect(calls.jumpTo).toEqual([]);

  // Clicking again unmarks.
  row.click();
  await waitFor(() => expect(screen.queryByText('Close 1')).toBeNull());
});

it('clicking the title text switches to that tab (kata rxxe)', async () => {
  const { transport, calls } = makeTransport([
    tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
  ]);
  render(<ReviewView transport={transport} />);
  const title = await screen.findByText('Alpha');

  title.click();
  await waitFor(() => expect(calls.jumpTo).toEqual([1]));
  // The title click did not also mark the row.
  expect(screen.queryByText('Close 1')).toBeNull();
});

it('clicking the host text switches to that tab (kata rxxe)', async () => {
  const { transport, calls } = makeTransport([
    tab({ id: 1, url: 'https://a.com/page', title: 'Alpha' }),
  ]);
  const { container } = render(<ReviewView transport={transport} />);
  await screen.findByText('Alpha');

  (container.querySelector('.row .url') as HTMLElement).click();
  await waitFor(() => expect(calls.jumpTo).toEqual([1]));
});
```

Note: the existing test `'marks the cursor row and commits the close'` uses `press('x')` (keyboard) and stays valid. No existing test relied on a *row body click* jumping, so none needs deleting; verify by running the file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- ReviewView.test`
Expected: FAIL — row body click currently jumps; `.url` is a `<span>`, not a clickable link.

- [ ] **Step 3: Rewrite `src/view/Row.tsx`** with the new handler model:

```tsx
import type { TabInfo } from '@/shared/types';
import { isGrouped } from '@/shared/tabs';
import type { RecommendReason } from '@/core/recommend';

interface RowProps {
  tab: TabInfo;
  isCursor: boolean;
  isMarked: boolean;
  /** True while a drag-marquee band is covering this row (live preview). */
  isPending?: boolean;
  /** Advisory close-recommendation reasons (kata 9kb5); absent = no flag. */
  recommendReasons?: RecommendReason[];
  /** Jump to this tab — the title/host links (kata rxxe). */
  onActivate: () => void;
  /** Toggle this row's close-mark — row body, checkbox, advisory badge. */
  onToggle: () => void;
}

const REASON_BADGES: Record<RecommendReason, { label: string; title: string }> =
  {
    bookmarked: {
      label: 'bookmarked',
      title: 'Already bookmarked — click to mark for closing.',
    },
    'stranded-auth': {
      label: 'stale login',
      title:
        'Looks like a stranded login page (session likely expired) — click to mark for closing.',
    },
  };

function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === '/' ? '' : u.pathname);
  } catch {
    return url || '(blank)';
  }
}

export function Row({
  tab,
  isCursor,
  isMarked,
  isPending,
  recommendReasons,
  onActivate,
  onToggle,
}: RowProps) {
  const cls = [
    'row',
    isCursor && 'cursor',
    isMarked && 'marked',
    isPending && 'pending',
  ]
    .filter(Boolean)
    .join(' ');

  // Title + host are links: a plain click jumps to the tab. preventDefault stops
  // the anchor's own navigation (we call jumpTo instead); stopPropagation keeps
  // the row-body toggle (the <li> onClick) from also firing. draggable=false so
  // a drag that starts on a link feeds the marquee instead of a link-drag ghost.
  const activate = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onActivate();
  };

  return (
    <li class={cls} onClick={onToggle}>
      <input
        type="checkbox"
        class="mark"
        checked={isMarked}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        aria-label="Mark for closing"
      />
      {tab.favIconUrl ? (
        <img
          class="favicon"
          src={tab.favIconUrl}
          alt=""
          onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
        />
      ) : (
        <span class="favicon placeholder" />
      )}
      <a class="url" href={tab.url} draggable={false} title={tab.url} onClick={activate}>
        {hostOf(tab.url)}
      </a>
      <a class="title" href={tab.url} draggable={false} onClick={activate}>
        {tab.title}
      </a>
      <span class="row-fill" />
      <span class="badges">
        {tab.active && <span class="badge active">active</span>}
        {tab.pinned && <span class="badge">pinned</span>}
        {tab.audible && <span class="badge">audio</span>}
        {isGrouped(tab) && <span class="badge group">group</span>}
        {recommendReasons?.map((reason) => (
          <button
            key={reason}
            class="badge suggest"
            title={REASON_BADGES[reason].title}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            {REASON_BADGES[reason].label}
          </button>
        ))}
      </span>
    </li>
  );
}
```

- [ ] **Step 4: Update the `<Row>` render in `src/view/ReviewView.tsx`** — replace the existing Row element (the `onClick`/`onToggle` props) with:

```tsx
                <Row
                  key={item.tab.id}
                  tab={item.tab}
                  isCursor={item.index === state.cursor}
                  isMarked={state.marked.has(item.tab.id)}
                  recommendReasons={recs.get(item.tab.id)}
                  onActivate={() => void transport.jumpTo(item.tab.id)}
                  onToggle={() => dispatch({ type: 'toggleMarkId', id: item.tab.id })}
                />
```

(The `isPending` prop is added in Task 4.)

- [ ] **Step 5: Update `src/view/review.css`** — replace the `.url` and `.title` blocks (currently ~lines 198-210) with link-aware versions, and add hover + a fill spacer. Replace:

```css
.url {
  color: var(--muted);
  flex: none;
  max-width: 38%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

with:

```css
/* Title + host are links (kata rxxe): sized to their text so the trailing
   row-fill stays a click-to-select target. They look like text until hovered,
   when a traditional underline (+ link colour on the host) hints they're links. */
.row a.url,
.row a.title {
  color: inherit;
  text-decoration: none;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row a.url {
  color: var(--muted);
  flex: none;
  max-width: 38%;
}

.row a.url:hover {
  color: var(--accent);
  text-decoration: underline;
}

.row a.title {
  flex: 0 1 auto;
  min-width: 0;
}

.row a.title:hover {
  text-decoration: underline;
}

/* Flexible select surface between the title and the badges: clicking here
   toggles the row's mark (the <li> onClick). */
.row-fill {
  flex: 1 1 0;
  min-width: 0.75rem;
  align-self: stretch;
}
```

Then add a hover rule. Insert immediately AFTER the `.row { … }` block (after ~line 166) so the more-specific `.row.cursor` / `.row.marked` (which come later in the file) keep priority:

```css
.row:hover {
  background: var(--hover-bg);
}
```

And add `--hover-bg` to both `:root` blocks. In the light `:root` (after `--cursor-bg`):

```css
  --hover-bg: #f5f8ff;
```

In the dark `@media (prefers-color-scheme: dark) :root` (after its `--cursor-bg`):

```css
  --hover-bg: #20242c;
```

- [ ] **Step 6: Run tests + typecheck to verify they pass**

Run: `pnpm test -- ReviewView.test && pnpm typecheck`
Expected: PASS (all existing ReviewView tests still pass; new click tests pass; no type errors).

- [ ] **Step 7: Commit**

```bash
git add src/view/Row.tsx src/view/ReviewView.tsx src/view/review.css test/view/ReviewView.test.tsx
git commit -m "feat(rxxe): row body selects, title+host are tab-switch links, hover highlight"
```

---

### Task 4: Drag-marquee selection (useMarquee hook + wiring)

**Files:**
- Create: `src/view/useMarquee.ts`
- Modify: `src/view/ReviewView.tsx` (import + hook call + viewport `onMouseDown` + band overlay + `isPending` on Row + `.list-viewport` already holds the ref)
- Modify: `src/view/review.css` (band rectangle, pending tint, dragging user-select)
- Test: `test/view/ReviewView.test.tsx`

**Interfaces:**
- Consumes: `rowsInBand`, `autoScrollStep` from `@/view/marquee`; `RenderItem`; `Action` from `@/view/state`; `dispatch({ type: 'markIds', ids })`.
- Produces: `useMarquee({ viewportRef, items, rowHeight, dispatch }) → { onMouseDown, band, pendingIds }` where `band: { top: number; height: number } | null` (content-coordinate rectangle for the overlay) and `pendingIds: ReadonlySet<number>`.

- [ ] **Step 1: Write the failing test** — add to `test/view/ReviewView.test.tsx`. Helper + test:

```ts
function mouse(type: string, target: Element | Window, clientY: number) {
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY }),
  );
}

it('drag-marquee additively marks the rows the band covers (kata rxxe)', async () => {
  const { transport, calls } = makeTransport([
    tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
    tab({ id: 2, url: 'https://b.com', title: 'Beta' }),
    tab({ id: 3, url: 'https://c.com', title: 'Gamma' }),
  ]);
  const { container } = render(<ReviewView transport={transport} />);
  await screen.findByText('Alpha');

  const viewport = container.querySelector('.list-viewport') as HTMLElement;
  const firstRow = container.querySelector('.row') as HTMLElement;

  // Drag from y=2 (row 0) down to y=70 (covers rows at 0-28, 28-56, 56-84 →
  // ids 1,2,3). Past the 5px threshold ⇒ a drag, not a click.
  mouse('mousedown', firstRow, 2);
  mouse('mousemove', window, 70);
  mouse('mouseup', window, 70);

  // All three rows are marked (additive markIds), cursor unmoved.
  await screen.findByText('Close 3');
  expect(calls.jumpTo).toEqual([]);

  // The drag's trailing click on the row is suppressed (does not toggle a row
  // back off): still 3 marked after a click fires on the row.
  firstRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(screen.getByText('Close 3')).toBeTruthy();
});

it('a plain click (no drag) still toggles a single row, not a marquee', async () => {
  const { transport } = makeTransport([
    tab({ id: 1, url: 'https://a.com', title: 'Alpha' }),
    tab({ id: 2, url: 'https://b.com', title: 'Beta' }),
  ]);
  const { container } = render(<ReviewView transport={transport} />);
  await screen.findByText('Alpha');

  const firstRow = container.querySelector('.row') as HTMLElement;
  // mousedown + mouseup at the same point (no movement) ⇒ a click, which the
  // <li> onClick turns into a single toggle.
  mouse('mousedown', firstRow, 10);
  mouse('mouseup', firstRow, 10);
  firstRow.click();
  await screen.findByText('Close 1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- ReviewView.test`
Expected: FAIL — no marquee yet; `Close 3` never appears.

- [ ] **Step 3: Implement `src/view/useMarquee.ts`**

```tsx
import { useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';

import type { RenderItem } from '@/view/renderItems';
import type { Action } from '@/view/state';
import { rowsInBand, autoScrollStep } from '@/view/marquee';

/** Pixels the pointer must move before a press becomes a drag (vs a click). */
const DRAG_THRESHOLD = 5;
/** Distance from a viewport edge where a held drag starts auto-scrolling. */
const EDGE = 36;

interface MarqueeOpts {
  viewportRef: RefObject<HTMLDivElement>;
  items: RenderItem[];
  rowHeight: number;
  dispatch: (action: Action) => void;
}

interface MarqueeApi {
  onMouseDown: (e: MouseEvent) => void;
  band: { top: number; height: number } | null;
  pendingIds: ReadonlySet<number>;
}

/**
 * Drag-to-select over the review list. A press on the row area that moves past
 * the threshold becomes a vertical rubber-band; rows it covers preview as
 * pending and commit (additively) on release. Holding near an edge auto-scrolls
 * so the selection can run past the visible viewport. Geometry is in content
 * coordinates (item index × rowHeight), matching the virtualizer. (kata rxxe)
 */
export function useMarquee({
  viewportRef,
  items,
  rowHeight,
  dispatch,
}: MarqueeOpts): MarqueeApi {
  // Latest render values read by event handlers without re-binding listeners.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const rowHeightRef = useRef(rowHeight);
  rowHeightRef.current = rowHeight;

  const [band, setBand] = useState<{ top: number; height: number } | null>(null);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<number>>(new Set());

  // Drag bookkeeping (refs: mutated across raw DOM events, never rendered).
  const startContentY = useRef(0); // band anchor in content coords
  const startClientY = useRef(0); // for the click-vs-drag threshold
  const lastClientY = useRef(0); // latest pointer y (for auto-scroll recompute)
  const dragging = useRef(false);
  const suppressClick = useRef(false);
  const rafId = useRef<number | null>(null);

  const contentY = (clientY: number): number => {
    const el = viewportRef.current;
    if (!el) return clientY;
    const rect = el.getBoundingClientRect();
    return clientY - rect.top + el.scrollTop;
  };

  const recompute = () => {
    const cy = contentY(lastClientY.current);
    const lo = Math.min(startContentY.current, cy);
    const hi = Math.max(startContentY.current, cy);
    setBand({ top: lo, height: hi - lo });
    setPendingIds(new Set(rowsInBand(itemsRef.current, rowHeightRef.current, lo, hi)));
  };

  const stopAutoScroll = () => {
    if (rafId.current != null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
  };

  const tickAutoScroll = () => {
    rafId.current = null;
    const el = viewportRef.current;
    if (!dragging.current || !el) return;
    const vh = el.clientHeight;
    const pointerInViewport = lastClientY.current - el.getBoundingClientRect().top;
    const step = vh > 0 ? autoScrollStep(pointerInViewport, vh, EDGE) : 0;
    if (step !== 0) {
      const max = el.scrollHeight - el.clientHeight;
      el.scrollTop = Math.max(0, Math.min(max, el.scrollTop + step));
      recompute();
      rafId.current = requestAnimationFrame(tickAutoScroll);
    }
  };

  const onMouseMove = (e: MouseEvent) => {
    lastClientY.current = e.clientY;
    if (!dragging.current) {
      if (Math.abs(e.clientY - startClientY.current) < DRAG_THRESHOLD) return;
      dragging.current = true; // promote press → drag
    }
    e.preventDefault(); // suppress text selection while dragging
    recompute();
    if (rafId.current == null) rafId.current = requestAnimationFrame(tickAutoScroll);
  };

  const onMouseUp = () => {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    stopAutoScroll();
    document.body.classList.remove('dragging');
    if (dragging.current) {
      dispatch({ type: 'markIds', ids: [...pendingIdsRef.current] });
      suppressClick.current = true; // eat the trailing click from this drag
    }
    dragging.current = false;
    setBand(null);
    setPendingIds(new Set());
  };

  // Mirror pendingIds into a ref so onMouseUp commits the latest set (state in
  // the closure would be stale across raw DOM events).
  const pendingIdsRef = useRef(pendingIds);
  pendingIdsRef.current = pendingIds;

  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as Element;
    // Let the checkbox and group headers keep their own click behavior.
    if (target.closest('.mark, .group-divider')) return;
    suppressClick.current = false;
    dragging.current = false;
    startClientY.current = e.clientY;
    lastClientY.current = e.clientY;
    startContentY.current = contentY(e.clientY);
    document.body.classList.add('dragging');
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // Capture-phase click eater: after a drag, swallow exactly one click so the
  // release doesn't also toggle a row (or follow a link).
  const onClickCapture = (e: MouseEvent) => {
    if (suppressClick.current) {
      e.preventDefault();
      e.stopPropagation();
      suppressClick.current = false;
    }
  };

  // Attach the capture listener once to the viewport.
  const attachedRef = useRef(false);
  if (!attachedRef.current && viewportRef.current) {
    viewportRef.current.addEventListener('click', onClickCapture, true);
    attachedRef.current = true;
  }

  return { onMouseDown, band, pendingIds };
}
```

Note for the implementer: declare `pendingIdsRef` BEFORE `onMouseUp` references it at call time — in the code above `onMouseUp` only reads `pendingIdsRef.current` when invoked (after render), so the hoisted `const` is initialized by then; keep the `pendingIdsRef` block above `onMouseDown`. If the linter flags use-before-define, move the `pendingIdsRef` declaration up to just under the `band`/`pendingIds` state.

- [ ] **Step 4: Wire it into `src/view/ReviewView.tsx`.**

(a) Add imports near the other `@/view` imports:

```tsx
import { useMarquee } from '@/view/useMarquee';
```

(b) Call the hook. Place it AFTER `items`/`windowItems` are computed (the hook needs `items`), i.e. just before the `return (`:

```tsx
  const marquee = useMarquee({
    viewportRef,
    items,
    rowHeight: ROW_HEIGHT,
    dispatch,
  });
```

(c) Add `onMouseDown` to the `.list-viewport` div (it already has `ref={viewportRef}` and `onScroll`):

```tsx
        <div
          class="list-viewport"
          ref={viewportRef}
          onMouseDown={marquee.onMouseDown}
          onScroll={(e) => {
```

(d) Pass `isPending` to the Row (add the prop to the element edited in Task 3):

```tsx
                  isPending={marquee.pendingIds.has(item.tab.id)}
```

(e) Render the band overlay. Inside the `<ol class="list">`, as its first child (before the top spacer), add:

```tsx
            {marquee.band && (
              <div
                class="marquee-band"
                style={{
                  top: `${marquee.band.top}px`,
                  height: `${marquee.band.height}px`,
                }}
              />
            )}
```

- [ ] **Step 5: Add styles to `src/view/review.css`.**

(a) Make the viewport a positioning context — add `position: relative;` to the existing `.list-viewport` rule.

(b) Append these rules near the rows section:

```css
/* Drag-marquee (kata rxxe) ------------------------------------------------ */
.marquee-band {
  position: absolute;
  left: 0;
  right: 0;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border-top: 1px solid var(--accent);
  border-bottom: 1px solid var(--accent);
  pointer-events: none;
  z-index: 1;
}

/* Rows the band is currently covering (preview before release). */
.row.pending {
  background: var(--hover-bg);
  box-shadow: inset 2px 0 0 var(--accent);
}

/* Suppress text selection + link-drag ghosts while a marquee drag is active. */
body.dragging,
body.dragging .row {
  user-select: none;
}
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm test -- ReviewView.test && pnpm typecheck`
Expected: PASS — the drag marks 3 rows, the plain click toggles 1, trailing click suppressed, all prior tests green.

- [ ] **Step 7: Run the full suite + lint**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/view/useMarquee.ts src/view/ReviewView.tsx src/view/review.css test/view/ReviewView.test.tsx
git commit -m "feat(rxxe): drag-marquee additive row selection with edge auto-scroll"
```

---

### Task 5: Docs — README + in-app cheatsheet

**Files:**
- Modify: `README.md` ("Key Features" section)
- Modify: `src/view/ReviewView.tsx` (the `HELP` array, ~lines 38-51)

**Interfaces:** none (docs only).

- [ ] **Step 1: Add a mouse line to the in-app help** — in the `HELP` array in `ReviewView.tsx`, add an entry (it renders in the `?` cheatsheet):

```tsx
  ['mouse', 'click row to mark · click title/host to open · drag to select'],
```

- [ ] **Step 2: Add a README subsection** — under "Key Features", after the "Keyboard-Driven Review" block, add:

```markdown
### Mouse Interactions
The keyboard model has a full mouse complement: **click a row** (anywhere but the
links) to mark/unmark it for closing, **click the page title or host** to switch
straight to that tab, **hold-drag a box** over rows to select a run of them at
once (it auto-scrolls past the viewport), and rows highlight as you hover. The
keyboard cursor stays put — clicking and hovering never move it.
```

- [ ] **Step 3: Verify the build still typechecks**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md src/view/ReviewView.tsx
git commit -m "docs(rxxe): document review-list mouse interactions"
```

---

## Self-Review

**Spec coverage** (each design feature → task):
- Click row body → toggle mark → Task 3 (`onToggle` on `<li>`), state action reused.
- Title + host as tab-switch links, host underline-on-hover → Task 3 (`<a class="url/title">`, CSS hover).
- Drag-marquee, additive, live preview, edge auto-scroll → Task 4 (`useMarquee` + `markIds` from Task 1 + `rowsInBand`/`autoScrollStep` from Task 2).
- Hover highlight, no cursor move → Task 3 (`.row:hover`); cursor never moved (no `move`/`moveTo` dispatched on any mouse path).
- Marquee marks flow to commit/stash/undo → Task 1 (`markIds` writes the shared `marked` set).
- Docs (README + cheatsheet) → Task 5.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `Row` props `onActivate`/`onToggle`/`isPending` are defined in Task 3 and consumed identically in Task 4's wiring. `useMarquee` returns `{ onMouseDown, band, pendingIds }` (Task 4 interface) and is consumed exactly so in the wiring. `markIds` action shape matches between Task 1 (definition) and Task 4 (dispatch). `rowsInBand`/`autoScrollStep` signatures match between Task 2 and `useMarquee`.

**Known risk to watch during execution:** jsdom returns `0` for `getBoundingClientRect().top`/`clientHeight`, so `autoScrollStep` is guarded to no-op when `clientHeight <= 0` (keeps tests deterministic); the marquee tests keep the pointer mid-list. The real auto-scroll feel is verified in-browser, not in jsdom.
