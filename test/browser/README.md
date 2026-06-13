# Browser verification harness

Chrome-in-the-loop checks for behaviour that unit tests with `chrome.*` fakes
can't reach: group ejection on cross-window consolidation, virtualization spacer
math at scale, real dedup of `chrome://` tabs, side-panel asset loading.

These are **not** vitest tests (vitest only collects `*.test.ts(x)`). They are
driven by an agent through the [`chrome-devtools-mcp`](https://github.com/ChromeDevTools/chrome-devtools-mcp)
server: each function in `verify-harness.mjs` is a self-contained
`async () => {...}` whose body is injected into an extension page via the MCP
`evaluate_script` tool. They lean on the extension's own control surface
(`runCleanup` / `dumpState` / `getReview` / `getRecommendations` /
`importSettings` / `getRecords`, see `src/background/messageHandlers.ts`), so the
whole *set-config → stage → trigger → observe* loop runs with zero UI clicks.

## One-time setup

1. **Rebuild from main** — `git checkout main && pnpm build`. The harness loads
   `dist/`; it goes stale whenever pipeline code changes.

2. **MCP launch flags** — the project `.mcp.json` runs the server as:

   ```
   npx chrome-devtools-mcp@latest \
     --categoryExtensions \
     --ignoreDefaultChromeArg=--disable-extensions \
     --chromeArg=--load-extension=<abs>/dist \
     --chromeArg=--disable-features=DisableLoadExtensionCommandLineSwitch
   ```

   `--categoryExtensions` adds the extension tools (`install_extension`,
   `list_extensions`, …) and requires the default **pipe** connection (not
   `--browserUrl`). Dropping `--disable-extensions` is required because it is a
   Puppeteer default that hides all extensions. `.mcp.json` is gitignored (it
   carries a machine-specific absolute path); restart Claude/the MCP after
   editing it.

3. **Load the extension** — on Chrome 137+ the `--load-extension` switch is
   gated, so loading at runtime is the reliable path:

   ```
   install_extension({ path: "<abs>/dist" })
   ```

   The id is **stable**: `adgplbcmppgollmecedoilcppifiahih` (pinned by the `key`
   in `manifest.config.ts`).

## Running a scenario

```
new_page("chrome-extension://adgplbcmppgollmecedoilcppifiahih/src/options/options.html")
# inject HELPERS + a scenario body via evaluate_script (the options page is the
# scripting host: it has full chrome.* access and survives runCleanup).
```

- **Logic/state scenarios** (`hz3t_*`, `d1d8m_*`, `swbr_0awf_*`, `recommend_*`,
  `e6f0_*`) run entirely from the options page and assert off `dumpState` /
  `getReview` / `getRecords`.
- **UI scenarios** (`yrez_49m8_*`, `mvzz_*`): stage + `runCleanup` from the
  options page, then `select_page` the review page before injecting the DOM
  scenario. `mvzz` needs ~205 `data:` tabs staged first (see the function's
  doc comment).
- **`b08q`**: `new_page` the sidepanel URL, then `list_network_requests`
  (expect all `200`) + `list_console_messages` (expect none) + the mount check.

Every scenario returns `{ ...evidence, pass }` and never throws.

## Last run

2026-06-13, Chrome 149, extension id `adgplbcmppgollmecedoilcppifiahih`: all
scenarios `pass` — hz3t ×4, 1d8m, swbr, 0awf, 3ndp/k3jc/2gga, e6f0, 49m8/yrez,
mvzz (206 items → 27 rendered, no spacer drift), b08q (assets all 200).
Subjective sign-off items left to a human: the 49m8 badge-click cursor jump,
yrez/dark-mode aesthetics, and mvzz scroll feel (DOM held at ~27 nodes).
