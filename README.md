# Jankless

Jankless checks that a web UI stays smooth. It measures interactions and list scrolling in Chromium, compares each one with a stored baseline, and tells you which element and which code got slower.

![A replay of a demo trail journal scrolled 3,000px, played at a quarter of real speed: the frame rate falls to about 30 frames per second as frames are dropped](docs/replay-frame-rate.gif)

This demo journal scrolls itself with a script that moves the page on every frame. Half its frames are dropped, so it runs at about 30 frames per second. No single frame took 50ms, so the browser's Long Animation Frames API reported nothing. The dropped frames came from Chrome's own frame timeline. When a check like this gets worse, the test gets this replay attached.

It only warns until you switch a check to fail, and it sends no data anywhere. The engine and the Playwright package have no third-party runtime dependencies. The [FAQ](docs/faq.md) covers how much time it adds to a suite, how it stays steady in CI, and how it differs from Lighthouse and real-user monitoring.

## Three ways to use it

| Use                                                              | Package               | Start at                                          |
| ---------------------------------------------------------------- | --------------------- | ------------------------------------------------- |
| Checks in your [Playwright](https://playwright.dev) tests and CI | `playwright-jankless` | [Install](#install)                               |
| Measuring a page from the command line while you work on it      | `chrome-jankless`     | [Measure without a test](#measure-without-a-test) |
| A coding agent that checks its own changes                       | `jankless-mcp`        | [The MCP server](#the-mcp-server)                 |

All three use the same measuring engine, [`jankless`](packages/jankless), so they measure the same things in the same way. Most of this page is about the first one, checks in Playwright tests.

## Install

```bash
npm install -D playwright-jankless
```

It needs Node 20 or later and `@playwright/test` 1.49 or later. Measurements run in Chromium, and new headless mode is closest to real Chrome:

```ts
// playwright.config.ts
use: { browserName: 'chromium', channel: 'chromium' },
```

## Usage

### Measure every test

```ts
// tests/fixtures.ts
import { test as base } from '@playwright/test';
import { withJankless } from 'playwright-jankless';
export const test = withJankless(base, { auto: true });
export { expect } from '@playwright/test';
```

Tests that import `test` from this file are measured as they run, with no other changes. Each test is measured once across its whole run, and every interaction is listed with its element, such as `click on button#checkout: 180ms`. A test is compared with the median of its recent passing runs on your main branch, and anything that got worse gets an annotation. [Automatic mode](docs/automatic-mode.md) covers how that history is kept in CI.

### Measure an interaction

```ts
// tests/jankless.spec.ts
import { test, expect } from 'playwright-jankless';

test('filters open smoothly', async ({ page, jankless }) => {
  await page.goto('/articles');
  const result = await jankless.measure('open filters', async () => {
    await page.getByRole('button', { name: 'Filters' }).click();
  });
  expect(result).toBeSmooth();
});
```

`measure()` slows the CPU 4x, runs your action once as a warm-up, then reloads the page and runs it 5 more times, waiting each time until the page has loaded and gone quiet. It reports the median of each measurement. Only work caused by the interaction counts: frames from page load, background timers and `setInterval` callbacks are left out.

That takes several times as long as the interaction itself, so these tests usually need a longer `timeout` than Playwright's 30-second default.

A test that opens its own page with `browser.newPage()` passes it as `page`: `jankless.measure('open filters', action, { page })`. `scroll()` measures the page its locator is on.

If a plain reload doesn't put the page back in the state your action needs, `reset` does it instead:

```ts
await jankless.measure('add to cart', action, {
  reset: async ({ page }) => {
    await page.goto('/product/42');
    await page.getByRole('button', { name: 'Accept cookies' }).click();
  },
});
```

### Scroll a list

![A replay of a demo cycling club feed scrolled at 6,000px/s: the page stays at 60 frames per second for most of the scroll, but the posts disappear and 115 of 124 frames are blank](docs/replay-blank-rows.gif)

A list can go blank without dropping frames. This demo feed builds its posts too slowly, so it stays at 60 frames per second for most of the scroll while the list is empty in 115 of 124 frames. `scroll()` measures both.

```ts
test.use({ hasTouch: true }); // input: 'touch' needs a touch-enabled context

test('catalog stays drawn during a fast swipe', async ({ page, jankless }) => {
  await page.goto('/catalog');
  const result = await jankless.scroll(page.getByRole('list', { name: 'Trending' }), {
    mode: 'full', // blank rows need the trace's screenshots
    input: 'touch', // 'wheel' (default) | 'touch' | 'keys'
    speed: 'fast', // 'slow' | 'normal' (default) | 'fast' | pixels per second
    distance: 20_000, // 'end' (default) | pixels
  });
  expect(result).toBeSmooth();
});
```

`scroll()` makes the same repeated, reloaded runs as `measure()`, with the scroll as the action:

- `'wheel'` sends a wheel gesture that the compositor scrolls.
- `'touch'` swipes with real touch events, and throws in a context without touch support, which needs `hasTouch: true` or a mobile device.
- `'keys'` presses the arrow keys 100ms apart and measures each press as an interaction.
- `direction` is `'vertical'` by default, or `'horizontal'`.
- `distance: 'end'` stops after 20,000px, and the result says how far the end really was. A pixel distance isn't capped.

In full mode, `scroll()` also counts blank frames: frames where the list was drawn to less than half of how it looks at rest. They mean rows that weren't built in time, which only happens in a virtualized list, one that removes rows as they scroll away and builds new ones. `scroll()` detects that by watching for removed rows, and only gates blank frames on a virtualized list. `list: { virtualized: true }` overrides the detection, and `list.placeholders` makes skeleton rows count as blank:

```ts
await jankless.scroll(list, { mode: 'full', list: { placeholders: ['.skeleton-row', '#e5e7eb'] } });
```

If the list never moves, for example because the locator isn't the element that scrolls, its blank-frame measurements are reported as unavailable, not as 0%. [List detection](docs/list-detection.md) explains how blank frames are found and what the detection misses.

### Replays

When a full-mode `measure()` or `scroll()` check gets worse, a video of one run is attached to the test in the Playwright report, played at a quarter of real speed. Under the recording it shows the frame rate at each moment, in red while frames are being dropped, beside a chart of the frame rate across the run with the elapsed time under the playhead. For `scroll()`, a frame where the list is blank is outlined and tagged. `replay: 'on'` attaches one every time, and `'off'` never does. Each full-mode check makes one extra run to record its replay, because recording takes compositor time, and that run is never counted. `'off'` skips it.

### Measure without a test

```bash
npx jankless measure http://localhost:5173/products --click "#filters"
```

`measure` opens a running page, does the steps or a `--scroll`, and compares the result with the last one recorded under the same label, so you can check a change before there's a spec for it. The first line of its output says whether the page is less smooth, smoother, or shows no clear change. [Measure without a test](docs/ad-hoc.md) covers the steps and options.

With `playwright-jankless` installed, the page opens in Playwright's Chromium. In a project that doesn't use Playwright, you can install [`chrome-jankless`](packages/chrome-jankless) instead, and the page then opens in the Google Chrome that's already installed on your machine:

```bash
npm install -D jankless chrome-jankless
```

## Baselines

The first run records a baseline next to your test, the way `toMatchSnapshot()` does, and passes. Later runs compare with it, and `npx playwright test --update-snapshots` records it again: `=all` replaces every baseline, `=changed` only those that got worse, and `=none` never writes. Renaming a test starts a new baseline.

A baseline belongs to one machine. Its key includes the label, test, project, platform, mode, refresh rate, CPU throttling and CPU model, because the same work took 150ms, 197ms or 226ms on different GitHub-hosted runners, as the [measurements](docs/measurements.md) page records. A baseline from your laptop isn't used in CI. In CI, baselines come from your main branch through `baselineDir`, and a run on a CPU model with no baseline yet skips its checks. The [CI guide](docs/ci.md) covers the GitHub Action, and a dedicated or self-hosted runner gives the steadiest results.

## Results

| Field                        | Meaning                                                                                                       | Gated    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- | -------- |
| `input.p95ToPaintMs`         | Time from an input, such as a click, tap or key press, to the next paint, 95th percentile, from Event Timing. | Yes      |
| `input.byTarget`             | The same, per element, such as `click on button#checkout`.                                                    | No       |
| `longFrames.count`           | Animation frames over 50ms caused by the interaction, from the Long Animation Frames API.                     | Yes      |
| `longFrames.totalBlockingMs` | Frame time beyond 50ms, added up. It's noisy, so it's only gated with `gateTotalBlocking: true`.              | Optional |
| `longFrames.topScripts`      | The scripts that ran in those frames, with the interactions they blocked, in `during`.                        | No       |
| `frames.onTimePercent`       | Full mode: frames presented on time, out of those with an update to show. Catches drops too short for LoAF.   | Yes      |
| `frames.dropped`             | Full mode: frames that missed their deadline.                                                                 | No       |
| `list.blankFramePercent`     | Full-mode `scroll()`: frames where the list was less than half drawn. Gated on a virtualized list only.       | Yes      |
| `list.leastDrawnPercent`     | Full-mode `scroll()`: the emptiest frame, as a percentage of the list at rest.                                | No       |
| `profile.hotFunctions`       | Full mode: the functions that used the most CPU, with their callers, from V8's sampling profiler.             | Never    |
| `budget120`                  | Full mode with `refreshRate: 120`: main-thread frames over 8.33ms, a prediction for 120Hz screens.            | Never    |

A check gets worse when it grows by more than `maxIncrease`, which is 15% by default, over its baseline, with a small floor so rounding can't trip it: 16ms of input-to-paint, 1 long frame, or 1 percentage point. On-time frames are compared on the share that was missed, so a fall from 95% to 81% can't pass as "within 15%". A value that couldn't be measured is `null`, never zero, and its reason is listed in `unavailable`.

Full mode traces each run, which adds about 5–25% to its time without changing the other measurements. [Trace categories](docs/trace-categories.md) has the timings. With React and Angular, the Long Animation Frames API names the framework's event dispatcher rather than your handler. The CPU profile in full mode names the handler itself, through your source maps when the build is minified, as [frameworks](docs/frameworks.md) explains.

## Warn first, then fail

`enforce: 'warn'` is the default. A check that got worse adds a `jankless-warning` annotation, prints the full report and, in GitHub Actions, a `::warning` on the pull request, but the test passes. Once you trust a check, `'fail'` makes it fail the test:

```ts
test.use({ janklessOptions: { enforce: 'fail' } });
// or for one assertion
expect(result).toBeSmooth({ enforce: 'fail' });
```

The message starts with what got worse and the scripts responsible:

```
"checkout" is less smooth than its baseline:
  input-to-paint (p95) 64ms (+48ms, +300%), slowest: click on button#heavy

Scripts blocking the interaction:
  1. onHeavyClick in click.js (BUTTON#heavy.onclick): ran 60ms, 12.6ms of it blocking, during click on button#heavy
```

## Fix briefs

When a check gets worse or misses its budget, a fix brief is written next to its result as `<result>.fix.md` and attached to the test. It's a short Markdown file meant to be pasted into a coding agent such as Claude Code or Copilot: what got worse and by how much, the interactions, scripts and functions behind it with their files and line numbers, and how to check a fix. The last part is there because a baseline belongs to one machine: the brief gives the exact command to record a baseline on the unchanged code, make the change, and run the check again, so the agent compares its fix with a baseline from its own machine and not with CI's.

```bash
npx playwright-jankless brief --results test-results
```

collects every brief from a run into one file, printed or written with `--out`. The GitHub Action adds them to its pull request comment, folded away under "Fix briefs for a coding agent".

### The agent skill

```bash
npx playwright-jankless init-agents
```

adds a skill that teaches coding agents what to do with a brief: which measurement to improve, how to read the scripts and functions it names, the usual causes and their fixes, such as forced layout, work on every scroll event or animation frame, re-rendering every component, and slow rows in a virtualized list, and how to prove the fix on their own machine without loosening the check. It goes in `.claude/skills/` for Claude Code and `.agents/skills/` for Codex and other agents that read skills from there, and `AGENTS.md` gets a short section that links to it for the rest. `--dir` puts it somewhere else. Running it again after an upgrade updates the skill, the way Playwright's own `init-agents` works.

The skill also ships in the package at `skills/playwright-jankless/`, where [TanStack Intent](https://tanstack.com/intent/latest) and [skills-npm](https://github.com/antfu/skills-npm) find it automatically. With either of those, the skill always matches the installed version and there's nothing to rerun.

The skill was checked by having an agent fix the slow version of each [demo app](demos/README.md#the-agent-skill-checked-against-them) using only its brief: all seven came back at or near the fast version's results.

### The MCP server

[`jankless-mcp`](packages/jankless-mcp) gives a coding agent the same measurements as tools. The agent measures an interaction before it changes anything, makes its change, and measures again to find out whether the page got smoother. It can also ask which functions used the most CPU.

```bash
npm install -D jankless-mcp
claude mcp add --transport stdio jankless -- npx jankless-mcp
```

The server measures in your installed Google Chrome, so there's no Playwright to set up and no browser to download. Its [README](packages/jankless-mcp/README.md) covers other agents and the options.

## Budgets

A baseline catches a change that made things worse. A budget is a fixed limit you choose for one check, and it's checked on every run, including the first:

```ts
expect(result).toBeSmooth({ budget: { minOnTimePercent: 90, maxLongFrames: 0 } });
```

| Budget                 | Checks                            | Measured in          |
| ---------------------- | --------------------------------- | -------------------- |
| `maxInputToPaintMs`    | `input.p95ToPaintMs`, at most     | both modes           |
| `maxLongFrames`        | `longFrames.count`, at most       | both modes           |
| `minOnTimePercent`     | `frames.onTimePercent`, at least  | full mode            |
| `maxBlankFramePercent` | `list.blankFramePercent`, at most | full-mode `scroll()` |

Missing a budget fails the test whatever `enforce` says, because you set the limit yourself. A budget that can't be checked fails too, with the reason, such as `minOnTimePercent` in quick mode, so a budget never passes silently. The failure message lists the budget first:

```
"scroll locator('html') 3000px" missed its budget:
  long frames 14 (budget: at most 0)
  frames on time 52.7% (budget: at least 90%)
```

Results depend on the machine and the CPU throttling, and runners vary, as [Baselines](#baselines) explains, so a budget works best as a generous limit on a machine you know. Each interaction needs its own limit: a sort that redraws a board once and then doesn't move can have only 20% of its frames on time and still be fast.

## Options

Options can be set for a whole project, for a file with `test.use({ janklessOptions: { ... } })`, or for one call as the last argument to `measure()` or `scroll()`:

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import type { JanklessTestOptions } from 'playwright-jankless';

export default defineConfig<JanklessTestOptions>({
  use: { channel: 'chromium', janklessOptions: { runs: 3 } },
});
```

| Option              | Default                                                         | Description                                                                                  |
| ------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `runs`              | `5`                                                             | Measured runs. The median is reported.                                                       |
| `cpuThrottling`     | `4`                                                             | How many times slower the CPU runs. `1` disables throttling.                                 |
| `maxIncrease`       | `0.15`                                                          | Allowed increase over the baseline.                                                          |
| `enforce`           | `'warn'`                                                        | `'warn'` or `'fail'`.                                                                        |
| `reset`             | `'reload'`                                                      | `'reload'`, `'none'`, or an async function.                                                  |
| `baselineDir`       | none                                                            | A folder of baselines from your main branch, checked before the ones next to the test.       |
| `gateTotalBlocking` | `false`                                                         | Also gate total blocking time.                                                               |
| `mode`              | `'quick'`                                                       | `'full'` adds a Chrome trace: dropped frames, a CPU profile and, for `scroll()`, blank rows. |
| `list`              | `{ background: 'auto', placeholders: [], virtualized: 'auto' }` | Full-mode `scroll()`: what counts as blank, and whether the list is virtualized.             |
| `replay`            | `'on-regression'`                                               | Full mode: when to attach a replay. `'on'` and `'off'` are the other values.                 |
| `refreshRate`       | `60`                                                            | `120` adds a 120Hz prediction in full mode that's reported but never gated.                  |

The mode can also come from the `JANKLESS_MODE` environment variable, and scheduled CI runs use full mode by default, as [mode detection](docs/mode-detection.md) describes.

## Reporter

```ts
// playwright.config.ts
reporter: [['list'], ['playwright-jankless/reporter']],
```

The reporter writes `test-results/jankless/summary.md`: each check's change against its baseline, such as `129ms (+20ms, +18%)`, the scripts and functions behind anything that got worse, and anything that couldn't be measured or compared. In GitHub Actions it's added to the job summary too. Its options are `outputFile`, `title` and `githubSummary`. Every result is also written as JSON, with `schemaVersion: 1`, under `test-results/jankless/` and attached to the test, so without the reporter, `npx playwright-jankless summary` writes the same summary from those files afterwards.

## Choose `maxIncrease`

```bash
npx playwright-jankless calibrate --runs 5 -- --project=chromium
```

`calibrate` runs your suite 5 times on unchanged code, without comparing or recording baselines, and prints how much each check moved between runs. For each check it suggests the smallest `maxIncrease`, in steps of 0.05, that covers that movement, and warns when a check needs more than the default. Arguments after `--` go to `playwright test`, and the results are also saved to `jankless-calibration.json`. It's best run on the machine that gates your builds, because that machine's noise decides whether a check passes.

## CI

On GitHub, two steps go around the step that already runs your Playwright tests, and that step stays as it is:

```yaml
- uses: denodell/jankless/setup@v1
- run: npx playwright test
- uses: denodell/jankless/report@v1
  if: always()
```

Pull requests compare against baselines recorded on main and get the summary as a comment. Pushes to main compare with the previous baselines, then record and publish new ones, and scheduled runs switch to full mode. For a new workflow, `uses: denodell/jankless@v1` does the same in one step and runs the tests itself. On other CI systems, setting `JANKLESS_RECORD_BASELINES=1` on main makes each check record its result into `baselineDir` after comparing, ready to upload.

The [CI guide](docs/ci.md) has the whole workflow, the Action's inputs, and the steps it takes for other CI systems. [`examples/github-actions`](examples/github-actions) has workflows ready to copy: the two steps added to an existing workflow, the Action running the tests itself, and the same steps written out manually.

## Limitations

- It measures in Chromium only. In Firefox and WebKit, measurements are skipped with a `jankless-skipped` annotation.
- Long frames and scripts come from the main thread, so jank on the compositor thread isn't blamed on any script.
- Headless Chrome runs at 60Hz, so 120Hz results are a prediction.
- Event Timing doesn't report interactions under 16ms, so `input.interactions` only counts slower ones.
- An action that navigates to a new page can't be measured, and the result says so.
- Work that starts more than a second after an input, such as a slow fetch that renders when it returns, isn't counted as that input's work. `measure()` also stops collecting half a second after the action's last input. If the work starts later than that, the action should include an `expect` for what appears, so the measurement doesn't end before the work has run.
- A page whose main thread is already busy for the whole interaction can't measurably get worse: added work takes time from the page's own rendering instead of adding to it, and only the CPU profile shows it. A development build is often like this with the CPU slowed 4x, so a production build is the one to measure. On [Actual](https://github.com/actualbudget/actual)'s transaction list, a planted 3ms per row went unreported in its dev build, and dropped frames on time from 59% to 27% in its production build.
- A dev server that watches your project, like Vite's, reloads its pages whenever a file it watches is rewritten. `--update-snapshots` rewrites baselines next to your tests while other tests are running, so main-branch CI wants a production build, such as `vite preview`, or the baselines in the dev server's ignored files. Automatic mode keeps its history in `node_modules/.cache`, which dev servers ignore.

## Documentation

- [FAQ](docs/faq.md): suite time, flakiness, requirements, privacy, and how it compares with Lighthouse and real-user monitoring
- [CI](docs/ci.md): the GitHub Action, the steps it takes for other CI systems, dedicated runners, and full mode on a schedule
- [Automatic mode](docs/automatic-mode.md): measuring every test with `withJankless()`
- [Measure without a test](docs/ad-hoc.md): `npx jankless measure`, the MCP server, and `jankless/adhoc`
- [List detection](docs/list-detection.md): how blank rows are found, and replays
- [Frameworks](docs/frameworks.md): React, Angular, and naming your handler through the CPU profile
- [How it works](docs/how-it-works.md): the browser signals used, how frames are classified, and how baselines are compared
- [Measurements](docs/measurements.md): the evidence behind the defaults

## Examples

- [`examples/plain-site`](examples/plain-site): a static page with a button and a long list. CI tests the baseline recipe against it.
- [`examples/react-list`](examples/react-list): a minified React windowed list, where full mode names the slow component through source maps.
- [`examples/github-actions`](examples/github-actions): the CI workflows from the CI guide, with and without the Action.
- [`demos`](demos): seven small apps, each with a fast and a slow version, from a trail journal to a design board.

## Packages

This repository publishes four packages. `playwright-jankless` is the one to install for checks in your tests. It depends on [`jankless`](packages/jankless), the measuring engine, which has the `jankless` command and doesn't depend on Playwright: other browser libraries can drive it through a small adapter. [`chrome-jankless`](packages/chrome-jankless) is a second adapter, which opens the Chrome that's installed on your machine and doesn't need a test runner. [`jankless-mcp`](packages/jankless-mcp) is the MCP server for coding agents, and it measures through `chrome-jankless` unless you choose Playwright. Those two are the only ones with third-party dependencies.

## License

MIT
