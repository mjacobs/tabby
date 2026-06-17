# Smarter grouping beyond lexical URL sort — design notes

**Tracking issue:** kata `eg4d` (design spike)
**Status:** design only — no implementation. Captures the backlog exploration of
ordering/grouping smarter than today's lexical-by-URL sort. Recommends a minimal,
opt-in v1 and defers the rest.
**Related:** `docs/close-recommendation-design.md` (kata `9kb5`, the shared
"interesting vs noise" classifier); DESIGN.md §2.4 (Sort) and §6 (Open
questions: "Smarter grouping beyond lexical URL sort (by domain, by topic)").

---

## Problem / CUJ

### The journey this serves

Tabby's core loop (DESIGN.md §1) is *consolidate → dedup → sort → review*. The
**sort** step exists to make the review list **fast to scan**: near-identical
pages sit adjacent so the eye (and the `j`/`k` cursor) sweeps a coherent block at
a time rather than ping-ponging across unrelated sites. This serves the same
recurring CUJ as the close-recommendation work: *tab overload → grounded state*,
several times a day.

### Where lexical sort falls short

Today `src/core/sortTabs.ts` orders every non-pinned unit by the `sortKey` that
`src/core/normalizeUrl.ts` produces:

```
sortKey = `${host} ${path} ${query}`   // host → path → query, raw hostname
```

That key is the **full hostname, verbatim**, so ordering is pure
ASCII-lexical-by-host. Concretely it scatters tabs that the user thinks of as
"the same place":

1. **Subdomains scatter.** `app.foo.com`, `docs.foo.com`, `foo.com`, and
   `api.foo.com` sort as `app… < api…`? No — `api.foo.com` < `app.foo.com` <
   `docs.foo.com` < `foo.com`. They land in *four different neighborhoods* of
   the list, interleaved with whatever other hosts sort between them
   (`apple.com`, `archive.org`, `figma.com`…). A multi-property org (Google:
   `mail.google.com`, `drive.google.com`, `calendar.google.com`,
   `docs.google.com`, `accounts.google.com`) is sprayed across the whole `g…`
   band instead of forming one block.

2. **`www` vs bare host split.** With `ignoreWww` **off** (the default —
   DESIGN.md §2.3 table), `www.foo.com` and `foo.com` are different sort keys and
   sort apart (`foo.com` < `www.foo.com`, with everything in between). The
   normalize option folds `www.` for *dedup equality* but the user leaves it off
   to avoid false merges, so the scatter persists in the sort.

3. **No notion of "registrable domain."** The eTLD+1 (the part a human reads as
   "the site": `foo.com`, `foo.co.uk`, `foo.github.io`) is never computed, so
   nothing can cluster by it.

The user's mental model is *organization / site*, not *exact hostname string*.
The lexical key optimizes for the wrong unit. v1 **explicitly** punted on this
("Fancy ML grouping. Sorting is lexical by URL, nothing smarter." — DESIGN.md
§1 Non-goals); this doc revisits the *non-ML* half of that punt.

### What "smarter" could mean (three escalating options)

- **(a) Registrable-domain sort key** — keep the flat sorted list, but cluster by
  eTLD+1 so `app.foo.com` / `foo.com` / `docs.foo.com` sit together. Pure
  reordering; no new browser objects. *(Recommended for v1.)*
- **(b) Domain-based auto-grouping** — materialize the clusters as real
  `chrome.tabGroups` in the strip (one group per registrable domain over a size
  threshold). Persistent, visible, but mutates the strip and collides with the
  existing group-integrity machinery.
- **(c) Topic / semantic grouping** — group by meaning ("all my React docs",
  "everything about the trip"). Requires content signals (and realistically a
  model). **Future / out of scope** — see Non-goals.

---

## Prior art

- **Tabby's own dedup key.** `normalizeUrl` already has the muscle for
  host-aware comparison (lowercasing, `www.` folding, tracking-param stripping).
  The registrable-domain key is the same idea pushed one level up the hostname.
- **Chrome's built-in "Group tabs by site / domain."** Recent Chrome ships a
  right-click "Add tab to group → New group" and an experimental auto-group; the
  domain heuristic there is naive (often groups by full host, splitting
  subdomains). Tabby can do better by grouping on eTLD+1. Lesson: users already
  expect "group my tabs by site" to be a one-action thing.
- **OneTab / Tabs Outliner** (covered in `docs/close-recommendation-design.md`)
  flatten or tree tabs but do **no** smart same-site clustering — the saved list
  inherits the scatter. Reinforces that de-scattering is a real, unmet need.
- **Public-suffix handling in the wild.** `tldts`, `psl`, and the canonical
  Mozilla Public Suffix List are the standard ways to compute eTLD+1. The
  tradeoff (bundle size vs. accuracy vs. maintenance) is the central design
  question for option (a) and is treated below.

---

## How it reuses the 9kb5 classifier

The close-recommendation work (`src/core/recommend.ts`, kata `9kb5`) and this
feature share **URL-shape reasoning over a flat tab list**, and the reuse is
concrete:

- **`normalizeUrl(url, settings.normalize)` (`src/core/normalizeUrl.ts`)** is the
  single chokepoint both features go through. The registrable-domain key is
  added **here** as a third field on `NormalizedUrl` (e.g. `groupKey`), so dedup,
  recommend, and sort all read host facts from one place. The existing `host`
  computation (lowercase + optional `www.` fold, lines 43–46) is exactly the
  input the eTLD+1 derivation needs — registrable domain is a pure function of
  that already-normalized host.

- **`recommend.ts`'s host helpers are the template for domain matching.**
  `matchesDomain(host, domain)` (recommend.ts:127) already implements
  "is `host` equal to `domain` or a subdomain of it" by suffix match, and
  `isExcluded` (recommend.ts:133) parses a host and tests it against a
  user-supplied domain list. The grouping feature wants the *inverse* operation
  (collapse a host **to** its registrable domain) but the same suffix-aware,
  `www.`-stripping, case-insensitive discipline applies — and the per-domain
  opt-out list pattern (`Settings.recommend.excludedDomains`) is the exact model
  for a grouping allow/deny list.

- **`urlCategory.classifyUrl` (`src/core/urlCategory.ts`)** gates what
  participates. Only `'web'` tabs get a registrable-domain key; `'blank'`,
  `'browser'`, `'extension'`, `'file'`, `'other'` keep today's pass-through
  behavior (their raw URL is the key, exactly as `normalizeUrl` returns it for
  non-http(s) — normalizeUrl.ts:37–39). This mirrors how `dedupe.resolveMode`
  (dedupe.ts:45) already branches on category, so grouping inherits the same
  "don't touch chrome:// / extension pages" safety for free.

- **The advisory-flag philosophy carries over.** 9kb5's north star is *recommend,
  the user decides; precision over recall; never destructive* (recommend.ts:1–6).
  Grouping is even safer (it's reorder/annotate, never close), but the same
  posture applies: **opt-in, off by default, easily reversible**, and it must
  never fight the user's explicit choices (manual groups, pinned order).

- **Records / undo overlap.** 9kb5 leans on the records log + undo buffer for
  safety. Auto-grouping (option b) is a strip mutation and should likewise be
  **undoable** and (optionally) logged to records, reusing that infrastructure
  rather than inventing its own.

The one thing grouping does **not** reuse is the *signal set* itself
(`isStrandedAuthUrl`, bookmarked-match): those answer "is this tab noise?",
whereas grouping answers "which tabs belong together?". Different question, same
plumbing.

---

## Data + storage model

### A new field on the normalize output

Extend `NormalizedUrl` (normalizeUrl.ts:11) without breaking existing callers:

```ts
export interface NormalizedUrl {
  normalized: string;   // unchanged — dedup equality
  sortKey: string;      // unchanged — today's host → path → query
  /** Registrable domain (eTLD+1) of the host, or the raw host when it can't be
   *  derived (IP literals, non-http(s), unknown suffix). Lowercased. */
  registrableDomain: string;   // NEW
}
```

`registrableDomain` is computed from the already-normalized `host`. For
non-http(s) URLs normalizeUrl returns early (lines 37–39); in that branch
`registrableDomain` is just the raw string, so those tabs never co-mingle.

### The grouping key

A new pure helper drives ordering. It composes the registrable domain with the
existing key so sorting is "cluster by site, then stable lexical within site":

```ts
// src/core/groupKey.ts  (NEW — pure, no chrome.*)
export function groupSortKey(n: NormalizedUrl): string {
  // registrableDomain first → all of foo.com clusters; then the existing
  // host/path/query key keeps deterministic order *within* the cluster.
  return `${n.registrableDomain} ${n.sortKey}`;
}
```

The ` ` separator guarantees the domain segment compares before any path
content and can't be spoofed by a crafted host.

### Registrable-domain derivation — the bundling question

Computing eTLD+1 correctly is **not** "take the last two labels": `foo.co.uk`,
`foo.github.io`, `foo.s3.amazonaws.com`, and `foo.com.au` all need the Public
Suffix List (PSL) to split right. Three approaches, with the tradeoff this issue
calls out explicitly:

| Approach | Accuracy | Bundle cost | Maintenance |
| --- | --- | --- | --- |
| **Naive last-2-labels heuristic** | Wrong for every multi-part TLD (`*.co.uk`, `*.github.io`, country domains) | ~0 | none |
| **Curated mini-suffix list** (top ~150 multi-part suffixes hand-picked) | Right for the common cases the author actually hits; wrong on the long tail | ~2–4 KB | manual, occasional |
| **Full PSL** (bundle `tldts` / `psl` / the raw list) | Correct | ~30–40 KB min, ~250 KB raw list | the list churns; needs a refresh job |

**Recommendation: the curated mini-suffix heuristic for v1.** Tabby's whole
runtime dependency tree today is **just Preact** (`package.json`), and the
project ethos is "pure, tiny, no broad permissions". Pulling a full PSL library
roughly doubles the bundle for a *sorting nicety* and adds a list-freshness
maintenance burden the rest of the codebase doesn't have. A small, in-repo
`PUBLIC_SUFFIXES` set — modeled on `DEFAULT_TRACKING_PARAMS`
(`src/shared/urlPatterns.ts`), which is exactly this "curated list that's good
enough and user-legible" pattern — covers the cases that matter (`co.uk`,
`com.au`, `github.io`, `*.amazonaws.com`, `pages.dev`, `vercel.app`, …). The
derivation algorithm is the standard PSL one (longest matching suffix, take one
more label); only the *table* is trimmed. The full-PSL path stays available as a
later upgrade (a build-time generated module) if the heuristic proves too coarse
in practice — the `registrableDomain` field's contract doesn't change.

Edge handling in the deriver:
- **IP literals** (`192.168.0.1`, `[::1]`): registrable domain = the literal
  itself; never split.
- **`localhost`, single-label hosts, `.local`**: registrable domain = the host
  as-is (so all of `localhost:3000`, `localhost:8080` cluster).
- **Unknown suffix** (not in the table): fall back to last-2-labels, which is
  correct for the overwhelmingly common single-part TLDs (`.com`, `.org`,
  `.dev`, `.io`, `.net`).

### Settings: a `grouping` block

A new opt-in settings group, parallel to the existing `recommend` block
(`src/shared/types.ts:66`). Persisted in `chrome.storage.sync` like everything
else, defaulted in `shared/settings.ts`:

```ts
interface Settings {
  // …existing…
  grouping: {
    /** Ordering strategy. 'lexical' = today's behavior. */
    mode: 'lexical' | 'registrable-domain';   // default 'lexical'
    /** v1.5+: also materialize clusters as chrome.tabGroups on sort. */
    autoGroup: boolean;                        // default false
    /** Don't auto-group clusters smaller than this (avoid 1-tab groups). */
    minClusterSize: number;                    // default 3
    /** Domains never auto-grouped (host or any subdomain). Mirrors
     *  recommend.excludedDomains. */
    excludedDomains: string[];                 // default []
  };
}
```

`mode` is the single user-facing lever for v1; `autoGroup` /
`minClusterSize` / `excludedDomains` are dormant fields reserved for option (b)
so the schema doesn't churn when it lands. No new storage surface, no migration
beyond a defaulted field (the settings loader already tolerates missing keys by
merging over defaults).

---

## UX surface

### v1 (registrable-domain sort)

- **Options page** (`src/options/options.tsx`): a "Grouping" section with a
  single control — *Order tabs by:* **Exact URL (default)** | **Site (domain)**.
  Off by default. Copy: "Cluster tabs from the same site together
  (`app.foo.com`, `docs.foo.com`, and `foo.com` sit as one block)." This is the
  whole v1 footprint — it changes the *order* of the existing review list, adds
  no new widgets to the review view.

- **Review view** (`src/view/ReviewView.tsx`): no structural change required. The
  list is already grouped visually by adjacency; registrable-domain mode just
  makes the adjacency match the user's mental model. Optionally (nice-to-have,
  not required) a subtle **domain divider** between clusters — the view already
  renders group dividers (PLAN.md Phase 3), so the same divider component can key
  off `registrableDomain` changes between consecutive rows.

### Option (b) auto-grouping (future)

- A toggle "Also create tab groups by site" under the same Grouping section,
  plus `minClusterSize`. When on, the executor (after the sort) calls
  `chrome.tabs.group` to wrap each qualifying cluster, coloring/titling the group
  by domain. The review header gains an "Ungroup all" affordance, and the action
  is pushed onto the **undo buffer** so it's one keystroke to reverse.

---

## Open design questions (with recommended resolutions)

### Q1. Registrable-domain heuristic vs. full PSL?

**Resolved: curated mini-suffix table in v1.** See "bundling question" above. The
deciding factors: Tabby ships zero runtime deps beyond Preact; this is a
sort-ordering nicety, not correctness-critical; and the wrong answer degrades
gracefully (a mis-split host just sorts where lexical sort already put it).
Keep the deriver's table separate from its algorithm so swapping to a generated
full-PSL module later is a one-file change, not a rewrite.

### Q2. Does registrable-domain sort interact with group integrity in `sortTabs.ts` / `executor.ts`?

**Resolved: it changes only the *key*, not the *structure* — integrity is
preserved by construction.** `sortTabs` (sortTabs.ts) sorts two kinds of unit: a
group (one `Unit` keyed by its first member, internally sorted) and a singleton.
Registrable-domain mode swaps `keyOf` from `…sortKey` to `groupSortKey(…)`
**everywhere it's used** — both the within-group member sort (`byKeyThenPosition`)
and the unit key (`compareUnits`). Because the group is still **one opaque unit
positioned by its first member's key** (sortTabs.ts:54–57), the executor's
whole-group `moveGroup` path (executor.ts:90–103) is untouched: groups still move
as whole units, members still get in-span re-sorts. The change is confined to
*how a key string is computed*; the unit partitioning, the pinned-lead rule, and
the "members sorted within the group's span" invariant all hold verbatim. **No
change to `executor.ts` is needed for option (a).**

One subtlety worth a test: a user's **manual** tab group may span multiple
registrable domains (a project group mixing `github.com` + `vercel.app` +
`localhost`). Registrable-domain mode must **not** try to break that group apart
— it's a user-authored unit. Today's code already guarantees this (the group is
keyed by its *first member* and kept contiguous), so the only requirement is a
regression test asserting a mixed-domain manual group survives the new key
intact.

### Q3. How does *auto-grouping* (option b) interact with existing groups?

**Resolved: auto-group only *ungrouped* tabs; never absorb or split a manual
group.** This is the hard one and the reason auto-grouping is **not** in v1. The
group-integrity invariant in `executor.ts` ("a tab group is repositioned with
`moveGroup`, never by moving its members across the strip" — executor.ts:32–46)
exists because moving a grouped tab out of its span *ejects* it. Auto-grouping
must respect the inverse: it may wrap a run of **currently-ungrouped** same-domain
tabs into a new `chrome.tabGroups` group, but it must treat every pre-existing
group as immovable-membership. Concretely: partition tabs into
{manual groups, ungrouped}; auto-group only operates on the ungrouped set; the
resulting synthetic groups then flow through the **same** `Unit`/`moveGroup`
machinery as manual ones. This keeps one code path for "move a group" and avoids
re-deriving the ejection bug PLAN.md Phase 2 already paid for.

### Q4. Default state?

**Resolved: off by default (`mode: 'lexical'`).** Mirrors 9kb5's opt-in posture
and DESIGN.md's "predictable and conservative" goal. Changing the strip/review
order is a visible behavior shift; the user opts in. Lexical remains the safe,
documented default so existing users see no surprise.

### Q5. Should `mode: 'registrable-domain'` also fold `www`?

**Resolved: yes, implicitly — registrable domain discards the subdomain entirely,
so `www.foo.com` and `foo.com` always share a key** regardless of the
`normalize.ignoreWww` setting. This is *only* about clustering, not dedup
equality, so it can't cause a false merge (dedup still uses `normalized`, which
honors `ignoreWww`). This is a feature: it fixes the "www vs bare split" scatter
listed in the Problem section without the user having to touch dedup settings.

### Q6. Where does the registrable-domain derivation live — `normalizeUrl` or a new module?

**Resolved: the *field* lives on `NormalizedUrl`, the *derivation* lives in a new
`src/core/registrableDomain.ts`** (pure, table + algorithm) that `normalizeUrl`
calls. Keeps `normalizeUrl.ts` readable and gives the PSL table its own
unit-tested home (parallel to how `urlPatterns.ts` owns the tracking-param
table). The grouping *key composition* lives in `src/core/groupKey.ts`. Three
small, single-responsibility modules, each table-testable.

### Q7. Topic/semantic grouping?

**Resolved: out of scope, recorded as future.** It needs content signals the
extension doesn't have cheaply and, realistically, a model. v1's non-goals
forbid network calls and ML (DESIGN.md §1). If ever revisited, the cheapest
non-ML proxy is *title-token clustering* (shared significant words across tab
titles), which stays local and dependency-free — noted only so a future reader
knows the least-bad on-ramp. See Non-goals.

---

## Proposed minimal v1 scope

**Ship option (a) only: a registrable-domain sort mode, opt-in, off by default.**

In scope:
1. `src/core/registrableDomain.ts` — curated `PUBLIC_SUFFIXES` table + longest-
   suffix derivation, with the IP/localhost/unknown fallbacks above.
2. `registrableDomain` field added to `NormalizedUrl` in `normalizeUrl.ts`.
3. `src/core/groupKey.ts` — `groupSortKey(NormalizedUrl)`.
4. `sortTabs.ts` reads `settings.grouping.mode`; when `'registrable-domain'`,
   `keyOf` uses `groupSortKey`, else today's `sortKey`. **No other behavior
   changes; group/pinned integrity untouched.**
5. `Settings.grouping` block (with the dormant auto-group fields) + a default in
   `shared/settings.ts`.
6. Options-page "Grouping" section with the single Exact-URL | Site selector.
7. Tests: PSL table cases (`co.uk`, `github.io`, `amazonaws.com`, IP, localhost,
   unknown-TLD fallback); sort clusters `app.foo.com`/`foo.com`/`docs.foo.com`
   adjacently; **mixed-domain manual group survives intact**; pinned-lead
   unchanged; lexical mode is byte-for-byte unchanged (regression guard).

Out of v1: auto-grouping into `chrome.tabGroups` (option b), topic grouping
(option c), domain dividers in the review view (nice-to-have), per-domain
grouping opt-out UI (field reserved, no UI yet).

This is the smallest change that fixes the real pain (subdomains/`www`/multi-
property scatter), reuses the existing key chokepoint, touches **one** branch in
`sortTabs.ts`, and provably can't break group integrity.

---

## Suggested build sub-issues

1. **`registrableDomain.ts` + curated PSL table** — pure module, the
   IP/localhost/unknown fallbacks, full unit-test table. *(No deps on the rest;
   start here.)*
2. **Thread `registrableDomain` onto `NormalizedUrl`** — extend `normalizeUrl`,
   confirm dedup/recommend callers are untouched (new field is additive).
3. **`groupKey.ts` + `sortTabs` mode branch** — wire `settings.grouping.mode`;
   regression-test lexical mode unchanged + new clustering behavior.
4. **`Settings.grouping` schema + defaults + options UI** — the block in
   `types.ts`, default in `settings.ts`, the single selector in `options.tsx`.
5. **Review-view domain dividers** *(optional polish)* — reuse the group-divider
   component keyed on `registrableDomain` changes.
6. **(Deferred — own spike) Auto-group into `chrome.tabGroups`** — option (b):
   ungrouped-only partitioning, `minClusterSize`, executor wrapping via
   `chrome.tabs.group`, undo integration, "Ungroup all" affordance. Depends on
   1–4 landing and resolving Q3 in code.

## Non-goals

- **No ML / no network for grouping (v1).** Reaffirms DESIGN.md §1. Topic and
  semantic grouping (option c) are explicitly future.
- **No full Public Suffix List dependency in v1.** Curated table only; the
  bundle-size/maintenance cost isn't justified for a sort nicety. Upgrade path
  preserved.
- **No auto-grouping into `chrome.tabGroups` in v1.** Reordering only. Auto-group
  is a separate, later sub-issue with its own group-integrity story (Q3).
- **No breaking the user's manual tab groups.** Smarter grouping never splits,
  merges, or reorders a user-authored group's membership — it only changes the
  sort key and (later, opt-in) wraps *ungrouped* runs.
- **No change to dedup equality.** Grouping touches *ordering* (`sortKey` /
  `groupKey`), never *identity* (`normalized`). Two tabs that weren't duplicates
  before are not duplicates after.
- **No new permissions for v1.** Registrable-domain sort is pure local
  computation. (Auto-grouping reuses the already-granted `tabGroups` permission —
  manifest.config.ts already lists it — so even option b needs nothing new.)
- **Not auto-enabled.** Off by default; the user opts in from the options page.
