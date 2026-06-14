# Chrome Web Store Listing — Tabby

This document serves as the single source of truth for Tabby's Chrome Web Store listing. It contains all metadata, permissions justifications, privacy disclosures, and version history needed to submit Tabby to the Chrome Developer Dashboard.

> Last Updated: 2026-06-13

---

## Store Listing

**Extension Name** [REQUIRED]
Tabby — Fast, Keyboard-Driven Tab Cleanup

**Short Description** [REQUIRED]
Consolidate, deduplicate, and organize your browser tabs into a keyboard-first review list for quick, seamless pruning.

**Detailed Description** [REQUIRED]
Tabby is a keyboard-first browser extension designed to help you regain control of your browser tabs and optimize your memory usage without losing your flow. With a single keyboard shortcut, Tabby gathers all your tabs from multiple open windows, cleans up duplicates, sorts them logically by URL category, and drops you into a sleek, vim-inspired review surface.

Key Features:
- Automated Cleanup Pipeline: Consolidate tabs from all open windows into one, remove exact duplicates and blank-tab clutter, and sort them lexicographically (Host → Path → Query) to place similar topics together.
- Keyboard-Driven Review: Navigate, filter, mark, and close your tabs entirely with speed-focused, vim-inspired keys (j/k to move, x to mark, V for range selection, Cmd+Enter to commit).
- Dual Review Surfaces: Use Tabby in a full-browser tab for a wide, comprehensive view, or toggle Side Panel mode to review tabs side-by-side with your active webpage without disrupting your browsing.
- Session-Aware Undo: Committed a close too quickly? Tabby buffers closed tabs and restores them instantly, including their full back-forward browser navigation history.
- Local Records Log & Navigation Trace: Track your recommendations and close patterns over time with local, telemetry-free data. Opt-in to Navigation Trace to analyze how redundant tabs are created.
- Highly Configurable: Edit query parameter normalizations, customize tracking parameter blocks (e.g., utm_*, gclid), adjust duplicate keep-policies, and save your preferences via Sync storage.

All Tabby operations happen 100% locally on your computer. Tabby is telemetry-free, respects your privacy, and transmits no data off your device.

**Category** [REQUIRED]
Productivity

**Single Purpose** [REQUIRED]
Consolidates, deduplicates, and organizes your browser tabs into a keyboard-first review list for quick, seamless pruning.

**Primary Language** [REQUIRED]
English

---

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `src/icons/icon128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 | ✅ Ready¹ | `store-assets/screenshot-1-review.png` |
| Screenshot 2 [RECOMMENDED] | 1280×800 | ✅ Ready¹ | `store-assets/screenshot-2-sidepanel.png` |
| Screenshot 3 [RECOMMENDED] | 1280×800 | ✅ Ready¹ | `store-assets/screenshot-3-options.png` |
| Screenshot 4 | — | ❌ N/A — no records UI page² | — |
| Small Promo Tile [RECOMMENDED] | 440×280 | ⬜ Not created | `store-assets/promo-small.png` |

¹ Store-dimension assets (1280×800) live in `store-assets/`, captured from the live extension via the `test/browser/` chrome-devtools-mcp harness. **Screenshot 2 is a composite** — Chrome's docked side panel is browser chrome the CDP can't screenshot directly, so it pairs a real page (web.dev) on the left with the panel surface (rendered at panel width via viewport emulation) on the right. The example session reuses the cat-themed tabs from the README; the `catster.com` tab was dropped from these shots because its host serves a Cloudflare interstitial to the automation profile (its title would read "Just a moment…"). Re-shoot anytime by re-running the harness. README-sized versions also live in `docs/img/`.

² Tabby has **no dedicated records/trace UI page** — the records log is data-only, read via the `getRecords` message or `chrome.storage.local('tabby:records')`. Screenshot 4 as originally scoped isn't capturable unless a records view is built; either drop it or replace it with another angle (e.g. the options "Close suggestions" + "Developer" sections, or the review list mid-keyboard-selection).

### Screenshot Notes
* **Screenshot 1 (Review Page):** Capture the full `review.html` surface populated with clustered, sorted tab entries, showing active group headers (now labelled by group **name**, not id), advisory badges, and the keyboard cheatsheet overlay (`?`) partially open.
* **Screenshot 2 (Side Panel):** Capture the side panel open alongside a standard website (e.g., Google or GitHub), demonstrating how a user can prune tabs side-by-side without leaving their webpage.
* **Screenshot 3 (Options/Settings):** Capture the options page showing query parameter normalization switches, custom tracking-parameter lists, and preferred review surface selections.
* **Screenshot 4:** No records page exists (see ² above) — repurpose this slot or omit it.

---

## Permissions Justification

The Google Chrome Web Store review team strictly audits extension permissions. Every permission declared in `manifest.config.ts` must have a specific, user-benefit-focused explanation of why it is required.

| Permission | Type | Justification |
|------------|------|---------------|
| `tabs` | permissions | Required to fetch details (URL, title, index, active status) of open tabs to generate the cleanup plan and display them in the review list, and to close them when committed. |
| `tabGroups` | permissions | Required to identify and preserve existing tab groups during consolidation, ensuring whole groups move as single units instead of being dissolved. |
| `storage` | permissions | Required to save user preferences, custom query normalizations, and tracking-parameter blocklists via synced storage across devices. |
| `sessions` | permissions | Required to support the "Undo" feature, buffering and restoring recently closed tabs along with their complete back-forward navigation history. |
| `bookmarks` | permissions | Required to cross-reference open tabs with the user's bookmarks and display helpful "Already Bookmarked" advisory flags on matching review items. |
| `webNavigation` | permissions | Required to analyze transition trails and patterns for the opt-in "Navigation Trace" feature, helping users audit how redundant tabs are spawned. |
| `sidePanel` | optional_permissions | Required to register and show the host-agnostic review interface within Chrome's native side panel when preferred and explicitly selected by the user. |

---

## Privacy & Data Use

This section maps directly to the Chrome Web Store Developer Dashboard's **Data Use Disclosure** form. Mismatches between your code and these disclosures will trigger immediate submission rejections.

### Data Collection

**Does the extension collect user data?** No.

All tab states, settings, normalizations, and records are processed and stored 100% locally on your machine. No analytics, tracking pixels, or remote API servers are used.

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

---

## Privacy Policy

**Privacy Policy URL** [RECOMMENDED]
*Suggest hosting on GitHub Pages, a public Gist, or a Notion page. Below is the exact text of Tabby's privacy policy to copy and host.*

```markdown
# Privacy Policy for Tabby

Last updated: 2026-06-11

Tabby is a browser extension designed for fast, keyboard-driven tab cleanup. We believe that your browsing data belongs to you and should stay on your machine.

## 1. What Data We Collect
Tabby does NOT collect, harvest, or transmit any personal data, browsing history, settings, or search queries. 

To perform its functions (consolidating, deduplicating, sorting, and reviewing your tabs), Tabby temporarily accesses your open tab metadata (URLs, titles, index, and tab groups) and buffers recently closed tabs locally to let you undo actions. This data is kept strictly inside Chrome's local extension memory.

## 2. How Data Is Stored
All data utilized by Tabby is stored locally on your device:
- **Settings & Preferences:** Saved in Chrome's native sync storage (`chrome.storage.sync`). If you are logged into Google Chrome, this data is encrypted and synced across your devices by Google, solely for your personal use.
- **Review Snapshots & Undo Buffer:** Stored temporarily in session-only storage (`chrome.storage.session`) or memory. This data is cleared when the Google Chrome browser is closed.
- **Records Log & Trace:** Stored locally in extension storage. It never leaves your machine.

## 3. Third-Party Services & Telemetry
Tabby does not use any third-party analytics, telemetry frameworks, tracking cookies, or external advertising APIs. We do not make any network requests to remote servers.

## 4. Data Sharing
We do not, and can never, share your data with third parties because we do not collect or store it in the first place.

## 5. Contact
If you have any questions or concerns regarding this privacy policy, please contact us at:
mjacobs@apache.org
```

---

## Distribution

**Visibility**: Public (or Unlisted if sharing with selected testers first)
**Regions**: All regions
**Pricing**: Free

---

## Developer Info

**Publisher Name** [REQUIRED]
Matthew Jacobs

**Contact Email** [REQUIRED]
[mjacobs@apache.org] (or chosen developer email)

**Support URL / Email** [RECOMMENDED]
https://github.com/mjacobs/tabby/issues — live (repo published 2026-06-13).

**Homepage URL** [RECOMMENDED]
https://github.com/mjacobs/tabby

---

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| `0.0.1` | 2026-06-11 | Initial draft build. Includes core consolidation pipeline, keyboard review list, side panel and options page. | Draft |

---

## Chrome Web Store Scoping & Submission Guide

This section outlines the steps, gotchas, and effort required to move Tabby from local development to the official Chrome Web Store (CWS).

### 📋 1. Required Preparation Steps

1. **One-Time Developer Registration ($5 USD):**
   Google requires a one-time fee to open a Chrome Developer account. Register at: [Chrome Developer Console](https://chrome.google.com/webstore/devconsole).
2. **Setup a Public Privacy Policy URL:**
   Even though Tabby collects no data, utilizing permissions like `tabs`, `bookmarks`, and `webNavigation` triggers a mandatory review audit. You must host the privacy policy text provided above (e.g. at `https://mjacobs.github.io/tabby/privacy.html` or a public GitHub Gist) and paste the URL in the console. The repo is now public, so GitHub Pages on `mjacobs/tabby` is the natural host.
3. **Generate Store Screenshots:** ✅ Done.
   Three 1280×800 assets are ready in `store-assets/` (review, side-panel composite, options), captured via the `test/browser/` chrome-devtools-mcp harness — see Graphics & Assets above. There is no records/trace page to capture (note ²). A 440×280 promo tile is still outstanding if you want one.
4. **Remove Dev "key" from Production Build:**
   * **Crucial Gotcha:** In `manifest.config.ts`, there is a pinned `"key"` field. This key is used in development to keep the extension ID stable (so storage doesn't get wiped on every reload). **Do not include this key in the ZIP uploaded to the store!**
   * Chrome Web Store automatically generates its own public key and signs the package. If you upload a manifest with a hardcoded `"key"` field, Google will either reject it or lock you into that specific keypair.
   * *Resolution:* The build pipeline or packing process must strip the `"key"` property from the resulting `manifest.json`.

### 📦 2. Packing for Production (Clean ZIP)

To create a compliant ZIP file, run the following command in the project root:

```bash
pnpm pack:store   # builds dist/, strips the dev "key", zips → tabby-extension.zip
```

This runs `pnpm build` and then `scripts/pack-store.mjs`, which removes the
pinned dev `"key"` from the ZIP's `manifest.json` (see the gotcha in §1.4) and
restores `dist/` afterwards so a locally loaded unpacked install keeps its
stable extension ID. Only the compiled `dist/` contents are bundled — no
`.git`, `node_modules`, test suites, or `CHROMEWEBSTORE.md`. Verify before
uploading:

```bash
unzip -p tabby-extension.zip manifest.json | grep -c '"key"'   # must print 0
```

### ⏱️ 3. Effort Estimate & Timeline

* **Asset Preparation & Form Filling (2–3 hours):**
  - Registering the developer account.
  - Setting up the hosted privacy policy URL.
  - Generating high-resolution screenshots and promo tiles.
  - Writing and proofreading store listing fields.
* **Review Turnaround (1–4 business days):**
  - Initial submissions for new developer accounts typically undergo a manual safety check.
  - Because Tabby requests broad permissions (`tabs`, `bookmarks`, `sessions`, `webNavigation`), it triggers a slightly deeper review.
  - Anticipate **2–3 days** before the extension transitions from *In Review* to *Published*.

### 🚀 4. Recommendation: Unlisted Test First
If you want to verify that `chrome.storage.sync` and the extension behave perfectly when signed by Chrome, upload the initial version with **Visibility: Unlisted**. You can then install it directly from the link to run a final smoke-test before flipping the visibility to **Public**.
