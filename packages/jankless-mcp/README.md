# jankless-mcp

An [MCP](https://modelcontextprotocol.io) server for [Jankless](https://github.com/denodell/jankless#readme). It lets a coding agent measure how smooth an interaction or a scroll is on a running page, and find out whether its change made the page better or worse, without writing a spec file.

## Install

```bash
npm install -D jankless-mcp
```

It needs Node 20 or later and Google Chrome. The server measures in the Chrome that's installed on your machine, through [`chrome-jankless`](https://github.com/denodell/jankless/tree/main/packages/chrome-jankless), so there's no browser to download and no test runner involved.

Then add the server to your agent. In Claude Code:

```bash
claude mcp add --transport stdio jankless -- npx jankless-mcp
```

In a client that takes a JSON configuration, such as Cursor or VS Code:

```json
{
  "mcpServers": {
    "jankless": {
      "command": "npx",
      "args": ["jankless-mcp"]
    }
  }
}
```

The server runs in your project's folder, and the page to measure has to be running already, on a dev server or a preview build.

## Tools

| Tool                  | What it does                                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `measure_interaction` | Opens a URL in Chromium, does the steps or the scroll several times with the CPU slowed, and reports how smooth it was. The first call records a baseline. |
| `compare_baseline`    | Measures a label again, exactly as it was last measured, and says whether the page is less smooth, smoother, or shows no clear change.                     |
| `get_hot_functions`   | Lists the functions that used the most CPU in a label's last result, and the scripts that ran in its long frames.                                          |

`measure_interaction` and `compare_baseline` send a progress update as each run starts, to clients that ask for them, because a measurement in full mode can take a minute or more.

A typical exchange, once the agent has been asked to make the filters panel open faster:

1. `measure_interaction` with `{ "url": "http://localhost:5173/products", "steps": [{ "action": "click", "selector": "#filters" }], "mode": "full" }`. It records the baseline and returns the label `click #filters on /products`.
2. `get_hot_functions` with that label, to find the code to change.
3. The agent makes its change.
4. `compare_baseline` with the label:

```
"click #filters on /products" is smoother than its baseline:
  input-to-paint (p95) 32ms (−64ms, −66.7%), slowest: click on button#filters
No clear change:
  frames on time 96% (+1.2 points)

Measured in full mode, CPU slowed 4x, the median of 5 runs.
```

A change that's too small to tell from noise is reported as "no clear change", so the agent doesn't count it as an improvement.

## Options

```bash
npx jankless-mcp --dir .jankless --results test-results
```

| Option            | Default                              | Description                                                                                |
| ----------------- | ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `--dir <folder>`  | `node_modules/.cache/jankless/adhoc` | Where baselines and results are kept.                                                      |
| `--results <dir>` | `test-results`                       | Playwright's output directory, so the tools can also look up a check from your test suite. |
| `--adapter <pkg>` | `chrome-jankless`                    | The browser adapter to measure with. `playwright-jankless` is the other.                   |

Three environment variables choose the Chrome. `JANKLESS_CHROME_PATH` is the path of another Chrome or Chromium to run. `JANKLESS_CHROME_URL` is the address of a Chrome that's already running with remote debugging, such as `http://127.0.0.1:9222`, and the server then measures in a new tab of that Chrome, with its cookies and sign-ins. `JANKLESS_CHROME_ARGS` adds command-line arguments, such as `--no-sandbox` in a container that runs as root.

With `--adapter playwright-jankless`, the server measures in Playwright's Chromium, as your tests do. That package and `@playwright/test` then have to be installed in the project. Selectors other than CSS differ between the two: Chrome takes Puppeteer's `::-p-text(Save)`, and Playwright takes `text=Save`.

The steps, the scroll options, baselines and limits are described in [Measure without a test](https://github.com/denodell/jankless/blob/main/docs/ad-hoc.md). The same measurements are available from the command line as `npx jankless measure`.

## License

MIT
