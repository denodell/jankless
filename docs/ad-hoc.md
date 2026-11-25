# Measure without a test

`jankless.measure()` and `jankless.scroll()` need a spec file. While you're working on a page, it's often quicker to measure it directly. You give Jankless the URL and what to do there, and it opens the page in Chromium, measures it the same way a test would, and compares the result with the last baseline for that check. You can do that from the command line, from a coding agent through the MCP server, or from your own script.

The engine, `jankless`, does the measuring, and a browser adapter opens the page and does the steps. There are two adapters:

- `playwright-jankless` opens Playwright's Chromium, as your tests do. Playwright's Chromium has to be installed first, with `npx playwright install chromium`.
- [`chrome-jankless`](../packages/chrome-jankless/README.md) opens the Google Chrome that's installed on your machine, and doesn't need Playwright. It can also join a Chrome that's already running, so you can measure a page while you're signed in to it.

If both are installed, `playwright-jankless` is used. You can choose the other one with `--adapter chrome-jankless`, or by setting `JANKLESS_ADAPTER=chrome-jankless`. Both adapters use the same baselines, and they run different browsers, so it's best to use the same adapter for a baseline and for the measurements you compare with it. When a baseline was recorded with a different browser version, the result includes a note about it.

The page has to be running already, on a dev server or a preview build. A production build gives the most useful results, for the reason in the README's [limitations](../README.md#limitations): a development build is often busy for the whole interaction with the CPU slowed 4x, so the extra work from a change doesn't appear in the results.

## Measure from the command line

```bash
npx jankless measure http://localhost:5173/products --click "#filters"
```

```
"click #filters on /products": baseline recorded. Measure it again after a change to compare.
  input-to-paint (p95) 96ms, slowest: click on button#filters
  long frames 1 (the longest 89.8ms)

Scripts in the long frames:
  1. onFilterClick in filters.js (BUTTON#filters.onclick): ran 80.9ms, 37.8ms of it blocking, during click on button#filters

Measured in quick mode, CPU slowed 4x, the median of 5 runs.
```

The first run records a baseline. After a change, the same command compares the new result with that baseline, and the first line of the output says whether the page got smoother or less smooth:

- `is less smooth than its baseline` when a check got worse by more than `maxIncrease`.
- `is smoother than its baseline` when a check improved by more than `maxIncrease` and nothing got worse.
- `no clear change from its baseline` when each check moved by less than `maxIncrease`. A difference that small can be noise, so it isn't reported as better or worse.

Each measurement is a warm-up run followed by 5 measured runs with the CPU slowed 4x, and the result is the median of those 5 runs, the same as with `measure()`. The page is loaded again before each run.

### Steps

The steps are measured in the order you give them:

| Flag                 | Step                                                                               |
| -------------------- | ---------------------------------------------------------------------------------- |
| `--click <selector>` | Clicks an element.                                                                 |
| `--hover <selector>` | Moves the mouse over an element.                                                   |
| `--type <text>`      | Types into the focused element, one key every 100ms, so each key is measured.      |
| `--press <key>`      | Presses a key, such as `Enter` or `ArrowDown`.                                     |
| `--wait <ms>`        | Waits, for an animation or a response that the next step depends on.               |
| `--steps <json>`     | The same steps as JSON, which also lets a `type` step name the element to type in. |

```bash
npx jankless measure http://localhost:5173/search \
  --click "#search" --type "trail shoes" --press Enter
```

A selector is a CSS selector. Other kinds of selector depend on the adapter. `playwright-jankless` takes any [Playwright selector](https://playwright.dev/docs/other-locators), such as `text=Save`, and `chrome-jankless` takes Puppeteer's, such as `::-p-text(Save)`.

`--setup` takes steps as JSON that run after each page load and before the measurement starts. That's where to open the dialog or the tab you want to measure inside, so that opening it isn't counted:

```bash
npx jankless measure http://localhost:5173/board \
  --setup '[{"action":"click","selector":"#open-settings"}]' \
  --click "#sort-by-date"
```

### Scroll

`--scroll` measures a scroll in place of steps, with the same options as `jankless.scroll()`. The selector is the element that scrolls, or `html` for the page itself:

```bash
npx jankless measure http://localhost:5173/feed --scroll "#feed" --speed fast --mode full
```

`--distance`, `--speed`, `--input` and `--direction` work as they do in [`scroll()`](../README.md#scroll-a-list). Full mode adds dropped frames and blank rows, and `--input touch` makes the page touch-enabled.

### Options

| Option                | Default   | Description                                                                                   |
| --------------------- | --------- | --------------------------------------------------------------------------------------------- |
| `--label <name>`      | see below | Names the baseline.                                                                           |
| `--baseline <use>`    | `compare` | `record` replaces the baseline with this result. `off` measures without comparing.            |
| `--mode <mode>`       | `quick`   | `full` adds dropped frames and a CPU profile.                                                 |
| `--runs <n>`          | `5`       | Measured runs.                                                                                |
| `--cpu <n>`           | `4`       | How many times slower the CPU runs. `1` disables it.                                          |
| `--max-increase <n>`  | `0.15`    | Allowed increase over the baseline.                                                           |
| `--budget <json>`     | none      | Fixed limits, such as `'{"maxLongFrames":0}'`. A missed budget exits with 1.                  |
| `--enforce <enforce>` | `warn`    | `fail` exits with 1 when a check got worse.                                                   |
| `--dir <folder>`      | see below | Where baselines and results are kept.                                                         |
| `--headed`            | off       | Shows the browser window.                                                                     |
| `--adapter <package>` | first one | The browser adapter to use: `playwright-jankless` or `chrome-jankless`.                       |
| `--json`              | off       | Prints the verdict and the whole result as JSON, in the same format a test's result file has. |

### Labels and baselines

Without `--label`, the label is built from the steps and the URL's path, such as `click #filters on /products`. So the same command always compares with its own baseline. The port is left out of the label, so a dev server that starts on a different port still uses the same baseline.

These baselines are for working on a change, and they aren't committed to the repository. A baseline is recorded on your machine, on the code as it was before you changed it, and it's kept with the results in `node_modules/.cache/jankless/adhoc`. Dev servers don't watch that folder, so writing to it doesn't reload the page being measured. In a project with no `node_modules`, the files go in the system's temporary folder instead. `--baseline record` replaces the baseline once the new results are the ones you want to compare with.

`npx playwright-jankless measure` is the same command. pnpm only links the commands of packages you install directly, so with pnpm that's the one to run, unless you add `jankless` as well.

These baselines are separate from the ones your tests record. A check that should run on every pull request belongs in a spec, with `toBeSmooth()`.

## Use it from a coding agent

`jankless-mcp` is an [MCP](https://modelcontextprotocol.io) server with the same measurements as tools, so a coding agent can check its own change before you review it. Its [README](../packages/jankless-mcp/README.md) covers the setup. It comes with `chrome-jankless`, so it measures in your installed Chrome unless you start it with `--adapter playwright-jankless`. It has three tools:

| Tool                  | What it does                                                                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `measure_interaction` | Measures the steps or the scroll on a URL, as `measure` does, and returns the label.                                                                                                     |
| `compare_baseline`    | Measures a label again, exactly as it was last measured, and compares it with the baseline. With `record`, it replaces the baseline.                                                     |
| `get_hot_functions`   | Lists the functions that used the most CPU in a label's last result, with their files, lines and callers, and the scripts that ran in its long frames. A result keeps the top 5 of each. |

The agent calls `measure_interaction` before it changes anything, makes the change, and then calls `compare_baseline` with the label. Each tool returns a few lines of text, with the verdict first, and the same results as structured content. A full trace would fill the agent's context, so the tools only return what was asked for.

`compare_baseline` and `get_hot_functions` also accept the label of a check from your test suite, or its test's title. They then return what the last test run found, from the result files in `test-results`. The server can't run the test again, so its reply says which test to run.

Measurements run one at a time, because two browsers measuring at once would take CPU time from each other. A measurement can take a minute or more in full mode, so the server sends a progress update as each run starts, to clients that ask for them. A client that resets its timeout on progress then keeps waiting until the measurement finishes.

## Call it from code

The same functions are exported from `jankless/adhoc`. They find the installed adapter themselves:

```ts
import { measureAdhoc, remeasure } from 'jankless/adhoc';

const first = await measureAdhoc({
  url: 'http://localhost:5173/products',
  steps: [{ action: 'click', selector: '#filters' }],
  label: 'open filters',
});
console.log(first.verdict); // 'baseline-recorded'

// …after a change
const again = await remeasure('open filters');
console.log(again.verdict); // 'worse', 'better' or 'no-clear-change'
console.log(again.text);
```

`measureAdhoc()` returns the verdict, the text shown above, and the [result](../README.md#results) with its comparison. `validateRequest()` checks a request without opening a browser.

## Limits

- Steps are clicks, hovers, typing, key presses and waits. Anything else, such as a drag, a file upload or signing in through another site, needs a spec, where the whole Playwright API is available.
- Each measurement opens a new browser with no cookies or storage, unless `chrome-jankless` joins a Chrome that's already running. In a new browser, a page behind a sign-in needs `setup` steps that sign in, or a spec.
- Steps that navigate to another page can't be measured, as with `measure()`.
- Replays aren't recorded, because there's no report to attach them to.
