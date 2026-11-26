# chrome-jankless

The Chrome adapter for [Jankless](https://github.com/denodell/jankless#readme). It measures how smooth an interaction or a scroll is on a running page, in the Google Chrome that's already installed on your machine. It doesn't need a test runner or a browser download, because it talks to the Chrome you already have through [`puppeteer-core`](https://pptr.dev).

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

The first run records a baseline. After that, the first line of each run's output says whether the page is jankier, smoother, or shows no clear change. [Measure without a test](https://github.com/denodell/jankless/blob/main/docs/ad-hoc.md) covers the steps, the scroll options and the baselines.

`--adapter` is only needed when `playwright-jankless` is installed too, because that adapter is used first when both are installed. Setting `JANKLESS_ADAPTER=chrome-jankless` chooses this adapter for every command.

[`jankless-mcp`](https://www.npmjs.com/package/jankless-mcp), the MCP server for coding agents, comes with this adapter and uses it unless you start the server with another one.

## Choose the Chrome

| Variable               | What it does                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `JANKLESS_CHROME_PATH` | Runs the Chrome or Chromium at this path, in place of the installed Google Chrome.                                                           |
| `JANKLESS_CHROME_URL`  | Joins a Chrome that's already running, by its remote debugging address, such as `http://127.0.0.1:9222`.                                     |
| `JANKLESS_CHROME_ARGS` | Adds command-line arguments, separated by spaces. Chrome's sandbox can't start as root or in some containers, so `--no-sandbox` is set here. |

From code, you can choose the installed build with a request's `channel`, which is `chrome` by default and can also be `chrome-beta`, `chrome-dev` or `chrome-canary`.

### Measure in a Chrome that's already running

When the adapter joins a Chrome that's already running, you can measure a page while you're signed in to it, with the data it really has. Chrome has to be started with remote debugging and its own profile folder, because recent versions don't allow remote debugging on your everyday profile:

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/jankless-profile
JANKLESS_CHROME_URL=http://127.0.0.1:9222 npx jankless measure http://localhost:5173/board --click "#sort"
```

The adapter opens its own tab for the measurement, closes that tab afterwards, and leaves Chrome running. A visible Chrome with other tabs and extensions uses CPU time for those too, so results vary more from run to run than they do in a headless Chrome. It's best to record the baseline and measure the change in the same Chrome.

## Selectors

A selector is a CSS selector or one of Puppeteer's other kinds, such as `::-p-text(Save)`, `::-p-aria(Save)` or `::-p-xpath(//button)`. Playwright's selectors, such as `text=Save` and `role=button`, only work with `playwright-jankless`. A step fails if its element isn't ready within 10 seconds.

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

`puppeteerDriver(page)` and `selectorTarget(page, selector)` are exported too, so you can measure a Puppeteer page of your own with the engine's `measure()` and `measureScroll()`.

## License

MIT
