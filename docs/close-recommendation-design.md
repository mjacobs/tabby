# Interesting-to-close tab recommendation — design notes

**Tracking issue:** kata `9kb5` (design spike)
**Status:** scope + cross-cutting decisions settled (2026-06-08). Remaining work
is mostly investigation (auth tracing) and writing the actual build design.
Started as "questions to think about"; most are now answered inline as decisions.

## The CUJ this serves: "tab overload → grounded state"

The recommendation feature isn't standalone — it serves a recurring journey the
user hits **several times a day**:

> Tabs accumulate over a browsing/work session until you literally can't see what
> you have open. At that point you want to "default" your browser back to a
> grounded state — clear the noise, keep what you actually care about.

Tabby's existing consolidate/dedup is step one (remove redundant tabs). The
close-recommendation pass is the **finishing touch**: once the obvious
redundancy is gone, the *uninteresting* tabs (dead logins, already-saved pages)
become visible, and clearing them leaves only the tabs that matter.

### Prior art the user has lived with (what to learn / avoid)

- **OneTab** — one button dumps *all* tabs into a saved list and clears the
  window. Blunt but effective at "get the noise off my radar *now*." Weakness:
  the **saved list inherits all the noise** — `google.com`, dozens of repeated
  Google searches, many `Inbox (155)` Gmail entries, repeated dashboards — so
  it's rarely revisited and only ctrl-F searchable. Lesson: a stash is only as
  valuable as it is *de-noised*; the same classifier that recommends closing live
  tabs should also clean what lands in any saved list.
- **Tabs Outliner / Link Map** — a manipulable **tree of windows/tabs** (current
  + historical). Good for seeing/operating on everything at once, but takes
  manual work to clear obvious noise. Both are closed-source, buggy freemium,
  and effectively unmaintained (Tabs Outliner's author vanished; Link Map is the
  semi-maintained successor). Lesson: there's a real, underserved niche here for
  an open, maintained tool — and *automatic* noise classification is the
  differentiator neither offers.

### Evidence from a real OneTab export (`~/tmp/one_tab_export_example_links.txt`)

The user's own dump validates the signal categories — it's full of exactly the
tabs this feature targets:

- **Stranded auth/login (signal 1):** `chase.com/logout`, `.../login` for
  Infisical, LibreChat, Manifest router, `login.brev.nvidia.com/signin`,
  `secure.newegg.com/...Authentication`, `localhost:3001/auth?redirect=`.
- **Generic/hub (the dropped signal — but real):** many `reddit.com` /
  `reddit.com/?feed=home`, `x.com/home`, and *dozens* of `google.com/search?q=…`.
- **Heavy cross-dump duplication (a NEW signal — see below):**
  `Inbox (155)` Gmail repeated ~6×, `pvez`/Proxmox many times, NPM proxy and
  Miniflux unread repeated across separate dumps.

### Lineage: the `tabz` v0 (`~/dev/projects/tabz`)

Tabby is the second attempt. The first — `tabz` (WXT + React + Zustand) — is by
the user's own account "terrible," yet they **used it consistently for months**.
That alone is strong validation that this CUJ is real and underserved. No code is
being carried over, but v0 prefigured nearly every thread of this design, which
is why they all feel coherent:

- A **cleanup rules engine** — user-authored `CleanupRule`s (conditions →
  close/pin/mute/group). This is the direct ancestor of the close-recommendation
  classifier. **Key evolution:** v0 made the *user* hand-author rules; the new
  direction is **automatic recommendation** so the user doesn't have to configure
  anything. Manual rules can remain an escape hatch, not the primary path.
- **Sessions** (save/restore) → the de-noised-stash idea (`dxph`).
- A **virtualized tab tree** → the tree/outliner view (`3ce9`).
- **Obsidian markdown export** → a precedent for the "records"/export angle.

Doesn't change any decision here; recorded so the design's origins are legible.

### Implication: the classifier is reusable; possible adjacent features

The "interesting vs. noise" classifier is the reusable core. Beyond live-tab
recommendations it could power these *separate future features* (filed as their
own issues, not in `9kb5`'s scope):

- A **de-noised stash** (OneTab done right): bulk-park tabs but filter/dedup the
  noise so the saved list stays valuable. → kata `dxph`
- A **tree/outliner view** (open Tabs-Outliner successor) with noise
  auto-flagged. → kata `3ce9`

The **cross-dedup signal** stays *inside* this issue (it's a classifier signal,
not a separate surface) — see signal 3 below.

## What this feature is (and isn't)

Tabby would flag tabs as *candidates for closure* based on signals that they're
uninteresting to keep open. It **recommends**; the user decides. This is
advisory only — never auto-close — and is distinct from the existing
consolidate/dedup cleanup flow.

The core bet: a small set of high-precision signals beats a clever scorer. A
recommender that's wrong even occasionally trains the user to ignore it, so
**precision matters more than recall.**

## Scope decision (2026-06-08)

**Signals in scope:** (1) stranded auth/login pages and (2) already-bookmarked
URLs for v1; (3) cross-duplicate URLs as a candidate to investigate (surfaced by
the OneTab-export evidence, may or may not make v1). **Generic / hub landing
pages are dropped** — too ambiguous (the "is the root the content" problem for
web apps, dashboards, localhost) for the value. Kept below under "Dropped" only
as a record of why.

## The signals

### 1. Stranded auth / login pages

Tabs bounced back to a login or challenge screen after a session expired, e.g.
`https://accounts.google.com/v3/signin/challenge/...`. They accumulate, no
longer hold the content they were opened for. The **financial / sensitive
account** category (banks, credit cards, brokerages) is the canonical case —
those sites time out aggressively, so they pile up.

**Can we observe "session timed out" from local state?** Not the session itself
— an extension can't read whether a bank session is valid (httpOnly cookies
aren't readable; cookie expiry ≠ session validity). But the *symptom* is fully
observable and is what we actually want: when a session expires the site
redirects the tab to a login URL, so "timed out" == "tab is now sitting at a
login/challenge page." Two ways to detect that:

- **Static (v1):** pattern-match the tab's *current* URL against known
  login/challenge URLs. No tracing needed.
- **Transition (stronger, investigate):** via `chrome.webNavigation` /
  `chrome.tabs.onUpdated`, watch for a tab going from authenticated content
  (`app.bank.com/dashboard`) to a login URL (`bank.com/login`) *with no user
  gesture*. Generalizes across sites without enumerating each one.

**Tracing to build the pattern set (the key idea).** Run a trace mode for a few
days that logs navigation events (from-URL, to-URL, transition type,
user-initiated?). Let real sites time out through the normal motions, then
harvest the login/challenge URLs they actually land on. This builds the pattern
list from observed data instead of guesses — and the trace log *is* essentially
the "records" feature (see Control/records below). This is the recommended first
investigation step before hard-coding any patterns.

Open questions:
- Starting seed for the static list (Google signin/challenge is one); expand
  from trace data.
- Distinguish a login the user is *mid-flow on right now* from one sitting stale
  — likely "how long since last interaction / since it landed here" matters.
- How aggressively to match financial hosts vs. a maintained pattern list.

### 2. Already bookmarked  *(suggest, never auto-close)*

The page is already saved, so the open tab is redundant.

Decisions:
- **Never auto-close bookmarked tabs.** Surface as "this is bookmarked — close to
  reclaim tab real estate?"
- **Exact-URL match** to start (not "host is bookmarked somewhere").
- **"Bookmark-then-close" inverse is deferred** — not in v1, revisit later.

### 3. Cross-duplicate URLs  *(candidate — investigate)*

Surfaced by the OneTab-export evidence above: the same URL recurs constantly
across sessions/dumps — `Inbox (155)` ~6×, Proxmox/NPM/Miniflux repeated. A URL
you keep re-opening and never act on is ambient background, not a task — a strong
"uninteresting / closeable" signal in its own right, and arguably less ambiguous
than the generic-site signal we dropped.

Stays *inside* this issue (it's a classifier signal, not a separate surface).

Open questions:
- Source of the "seen many times" count — requires the records/history store
  (ties to the records feature). Live duplicates within the current window are
  already handled by dedup; this is about *recurrence over time*.
- Threshold/decay: how many recurrences, over what window, before it counts?
- Interaction with bookmarked/auth signals (a recurring login is both).
- Whether it makes v1 or waits for records to mature.

## Dropped: generic / hub landing pages

Bare `google.com`, `reddit.com`, news front pages. **Dropped from scope** —
"is the root the content" (web apps, dashboards, `localhost`, internal tools all
live at `/`) makes a high-precision rule hard, and the value is marginal next to
the two kept signals. Recorded here so we don't re-litigate it from scratch; if
it ever comes back, "bare-host only, possibly gated on a second weak signal" was
the least-bad framing.

## Cross-cutting decisions

- **Surface — DECIDED: reuse the review list.** Recommendations show as flags /
  a "suggested to close" grouping in the existing review surface; no new surface.
- **Signal model — DECIDED: rule-based, defer anything learned.** Hand-tuned
  per-signal. Local usage counts (kata `g6gb`) become an optional signal only
  if/when they exist.
- **Combining signals — DECIDED: independent flags with reasons**, not a blended
  score. Each recommendation carries its reason ("bookmarked" / "stranded
  login").
- **User control — DECIDED: yes, provide knobs.** Per-signal on/off at minimum.
  Likely also per-recommendation dismiss and per-domain allowlist-out. Some
  categories are **opt-in** from the review page (see precision).
- **Precision / safety — DECIDED: err cautious, but not database-grade.** We
  lean conservative to keep trust, but this isn't a destructive op. Risk is
  countered by a layered safety net:
  - **Undo** (already exists in the close pipeline).
  - **Records** — a persistent log of what was recommended/closed and why.
    Likely a rebrand/expansion of today's debug logging into a first-class,
    user-facing "records" feature (also doubles as the auth-pattern trace source,
    see signal 1).
  - **Opt-in categories** — the more aggressive signals are off by default and
    enabled from the review page, so the user chooses the risk.
- **Relationship to cleanup flow — DECIDED: this is the "finishing touches"
  pass.** Run *after* consolidate/dedup has removed redundant tabs; with the
  noise gone, the uninteresting tabs become visible and clearing them leaves
  only the tabs the user actually cares about. Context: the user does this
  several times a day — tab accumulation gets bad enough that you can't even see
  what's open, and this is the "default my tabs back to a grounded state" move.

## v1 scope

Both kept signals: **stranded auth pages** and **already-bookmarked URLs**, as
independent advisory flags in the review surface. Generic/hub sites are out.

Suggested build order:
1. **Investigation spike — auth tracing.** Stand up navigation-event tracing /
   "records" logging; let real sites (esp. financial) time out; harvest the
   login/challenge landing URLs. Output: a real pattern set + a decision on
   static-pattern vs. transition-detection.
2. **Records surface.** Rebrand/expand debug logging into the user-facing records
   feature (also the trace sink from step 1) — part of the safety net.
3. **Already-bookmarked flag.** Exact-URL match, suggest-close. Self-contained;
   can proceed in parallel with 1.
4. **Stranded-auth flag.** Built on the pattern set / detection approach from 1.
5. **Controls.** Per-signal toggles, opt-in for aggressive categories,
   per-domain allowlist-out.

## Related issues

- `g6gb` — local, telemetry-free usage counts (future signal source)
- `eg4d` — smarter grouping beyond lexical URL sort (adjacent classification)
