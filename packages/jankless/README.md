# jankless

The measuring engine behind [playwright-jankless](https://www.npmjs.com/package/playwright-jankless). It measures how smooth a web page is in Chromium: dropped frames, slow input, long animation frames, and list rows that aren't drawn while you scroll. It then compares the numbers with a baseline.

If you test with Playwright, install `playwright-jankless` instead. It includes this package, and its [README](https://github.com/denodell/jankless#readme) covers everything you need.

## Writing an adapter

This package is for people writing an adapter for another browser automation library, such as Puppeteer. The engine never talks to a browser library directly. It uses two small interfaces from `driver.ts`, and your adapter implements them:

- **`PageDriver`** is the page being measured. It covers running a function in the page, adding an init script, reloading, a Chrome DevTools Protocol session, screenshots, tracing, a click, a key press, fetching a source map, and opening a scratch page.
- **`ElementTarget`** is the element to scroll. It covers running a function against the element, scrolling it into view, and focusing it.

An `ElementTarget` has to find its element again on every call, because each run reloads the page and replaces the element. A Playwright locator does this by itself, but an element handle from most other libraries doesn't.

With those in place, the steps are:

1. Call `preparePage(driver)` before the page's first navigation, so the in-page collector is there from the start.
2. Call `measure()` to measure an interaction, or `measureScroll()` to scroll a list and measure it. Both return the same versioned result that playwright-jankless writes.
3. Call `evaluate(result, target)` to compare the result with its baseline, then `formatMessage()` to explain what changed. The target is a `BaselineTarget`: a function that gives the path for a baseline file, the folder those paths sit under, a project name, and when to write the baseline.

The engine needs Chromium, because it relies on the Chrome DevTools Protocol and Chrome's trace events. The Playwright adapter, [`packages/playwright-jankless/src/driver.ts`](https://github.com/denodell/jankless/blob/main/packages/playwright-jankless/src/driver.ts), is about 130 lines and a good starting point.

## The command and ad-hoc measurements

The package has the `jankless` command. `summary` and `brief` read a run's result files, and `measure` measures a URL with no test around it, as `measureAdhoc()` from `jankless/adhoc` does. Measuring needs a browser, so the engine loads an adapter from the project it runs in: the `adapter` export of `<package>/adapter`, which is an `Adapter` object.

- `launch(options)` opens a browser and returns its page as a `PageDriver`, with `open(url)`, `runSteps(steps)`, `element(selector)` and `close()`.
- `commands` adds commands to `jankless` that only make sense with that library, such as playwright-jankless's `calibrate`.

The engine looks for the packages in `ADAPTER_PACKAGES`, in order: `playwright-jankless`, then `chrome-jankless`. A new adapter is added to that list, or named with `JANKLESS_ADAPTER`.

## Licence

MIT. The replay panel's font, Archivo, is included under the SIL Open Font License 1.1 (`ARCHIVO-OFL.txt`).
