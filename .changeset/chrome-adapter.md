---
'jankless': minor
'chrome-jankless': minor
'jankless-mcp': minor
---

A second browser adapter, which measures in the Chrome that's installed on your machine and doesn't need Playwright.

- `chrome-jankless` is a new package, built on `puppeteer-core`. It starts Google Chrome, or the Chrome or Chromium that `JANKLESS_CHROME_PATH` names, and with `JANKLESS_CHROME_URL` it joins a Chrome that's already running and measures in a new tab there.
- `jankless-mcp` comes with it and measures through it by default, so `npm install -D jankless-mcp` is the whole install. `--adapter playwright-jankless` measures in Playwright's Chromium as before.
- `npx jankless measure` takes `--adapter <package>`, and `JANKLESS_ADAPTER` names the adapter for every command. With neither, the first installed adapter is used: `playwright-jankless`, then `chrome-jankless`.
- `jankless` exports `adapterPackages()`, `noAdapter()` and `ADAPTER_ENV`, and `loadAdapter()` takes the packages to look for.
