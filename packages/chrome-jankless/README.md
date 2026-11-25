# chrome-jankless

The Chrome adapter for [Jankless](https://github.com/denodell/jankless#readme). It measures how smooth an interaction or a scroll is on a running page, in the Google Chrome that's already installed on your machine. There's no test runner and no browser to download: it talks to Chrome through [`puppeteer-core`](https://pptr.dev).

If you test with Playwright, [`playwright-jankless`](https://www.npmjs.com/package/playwright-jankless) is the one to install, and it measures inside your tests. This package is for measuring a page directly, from the command line or from a coding agent.

## Install

```bash
npm install -D jankless chrome-jankless
```

It needs Node 20 or later and Google Chrome.

## Measure a page

```bash
npx jankless measure http://localhost:5173/products --click "#filters" --adapter chrome-jankless
```

The first run records a baseline, and later runs say whether the page is jankier, smoother, or shows no clear change. [Measure without a test](https://github.com/denodell/jankless/blob/main/docs/ad-hoc.md) covers the steps, the scroll options and the baselines.

`--adapter` is only needed when `playwright-jankless` is installed too, since that one is found first. `JANKLESS_ADAPTER=chrome-jankless` does the same for every command.

[`jankless-mcp`](https://www.npmjs.com/package/jankless-mcp), the MCP server for coding agents, comes with this adapter and uses it unless it's told otherwise.

## Choose the Chrome

| Variable               | What it does                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `JANKLESS_CHROME_PATH` | Runs the Chrome or Chromium at this path, in place of the installed Google Chrome.                                                          |
| `JANKLESS_CHROME_URL`  | Joins a Chrome that's already running, by its remote debugging address, such as `http://127.0.0.1:9222`.                                    |
| `JANKLESS_CHROME_ARGS` | Adds command-line arguments, separated by spaces. Chrome's sandbox can't start as root or in some containers, and `--no-sandbox` goes here. |

From code, a request's `channel` chooses the installed build: `chrome` (the default), `chrome-beta`, `chrome-dev` or `chrome-canary`.

### Measure in a Chrome that's already running

Joining a running Chrome measures a page as you're signed in to it, with the data it really has. Chrome has to be started with remote debugging and its own profile folder, since recent versions don't allow remote debugging on your everyday profile:

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/jankless-profile
JANKLESS_CHROME_URL=http://127.0.0.1:9222 npx jankless measure http://localhost:5173/board --click "#sort"
```

The measurement opens its own tab, closes it afterwards, and leaves Chrome running. A visible Chrome with other tabs and extensions takes CPU time of its own, so its results vary more than a headless Chrome's. Record the baseline and measure the change the same way.

## Selectors

Selectors are Puppeteer's: CSS, and its `::-p-text(Save)`, `::-p-aria(Save)` and `::-p-xpath(//button)` forms. Playwright's `text=Save` and `role=button` only work with `playwright-jankless`. Each step waits up to 10 seconds for its element to be ready.

## Use it from code

```ts
import { measureAdhoc } from 'jankless/adhoc';
import { chromeAdapter } from 'chrome-jankless';

const outcome = await measureAdhoc(
  { url: 'http://localhost:5173/products', steps: [{ action: 'click', selector: '#filters' }] },
  { adapter: chromeAdapter({ browserURL: 'http://127.0.0.1:9222' }) },
);
console.log(outcome.verdict);
```

`puppeteerDriver(page)` and `selectorTarget(page, selector)` are exported too, for measuring a Puppeteer page of your own with the engine's `measure()` and `measureScroll()`.

## License

MIT
