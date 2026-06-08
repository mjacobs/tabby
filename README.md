# Tabby

A Chrome extension for fast, keyboard-driven tab cleanup. One trigger
consolidates tabs from every window into one, removes duplicates, sorts by URL,
and drops you into a keyboard-first review list to prune what's left.

See [`DESIGN.md`](./DESIGN.md) for the full design and [`PLAN.md`](./PLAN.md)
for the phased execution plan.

## Status

**v1.0 feature-complete (Phases 0–4) + side panel (Phase 5).** One click
(or `Ctrl/Cmd+Shift+K`) consolidates every window's tabs into the focused one,
removes duplicates and blank-tab clutter, sorts by URL, and opens a
keyboard-driven review list to prune what's left — with undo. A full settings
page tunes the behavior, and the review can be served either as a full page
(default) or in Chrome's side panel — same component, no view-logic fork. 69
tests, all green. See `PLAN.md` for the phase ledger.

### Keyboard (review list)

`j`/`k` move · `g`/`G` top/bottom · `x`/`space` mark · `V` then move then `x`
range-mark · `a`/`A` mark-all/clear · `/` filter · `Enter` jump to tab ·
`⌘/Ctrl+Enter` close marked · `u` undo · `?` help.

## Development

```bash
pnpm install
pnpm dev        # Vite dev server with HMR (crxjs)
pnpm build      # Production build → dist/ (loadable unpacked extension)
pnpm test       # Vitest (pure core/ logic)
pnpm typecheck  # tsc --noEmit
pnpm lint       # eslint
```

### Load the unpacked extension

1. `pnpm build`
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → select the `dist/` directory.
4. Click the Tabby toolbar icon (or press `Ctrl/Cmd+Shift+K`) to open the review
   page.

## Architecture (in brief)

- **`src/core/`** — pure, Chrome-free logic (URL normalization, dedup, sort,
  cleanup planning). Fully unit-tested without a browser.
- **`src/background/`** — MV3 service worker; orchestrates the pipeline and owns
  all Chrome API calls.
- **`src/view/`** — host-agnostic review UI (page now, side panel later).
- **`src/shared/`** — types and settings shared across layers.

## Tech stack

TypeScript (strict) · Vite + `@crxjs/vite-plugin` · Preact · Vitest.
