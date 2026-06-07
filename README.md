# Tabby

A Chrome extension for fast, keyboard-driven tab cleanup. One trigger
consolidates tabs from every window into one, removes duplicates, sorts by URL,
and drops you into a keyboard-first review list to prune what's left.

See [`DESIGN.md`](./DESIGN.md) for the full design and [`PLAN.md`](./PLAN.md)
for the phased execution plan.

## Status

**Phase 0 (scaffold) complete.** The extension loads, the toolbar action and
keyboard shortcut open the review page, and the pure `core/` logic layer has its
first tested module (`normalizeUrl`). The cleanup pipeline and review UI follow
in Phases 1–3.

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
