---
'playwright-jankless': minor
'jankless': minor
'jankless-mcp': minor
---

Measure a running page with no spec file.

- `npx jankless measure <url>` takes steps (`--click`, `--hover`, `--type`, `--press`, `--wait`) or a `--scroll`, measures them the way `jankless.measure()` and `jankless.scroll()` do, and compares the result with the last baseline recorded under the same label. Its first line says whether the page is jankier, smoother, or shows no clear change.
- `jankless/adhoc` exports the same thing for scripts: `measureAdhoc()`, `remeasure()` and `validateRequest()`.
- `jankless-mcp` is a new package: an MCP server with three tools for coding agents, `measure_interaction`, `compare_baseline` and `get_hot_functions`. The two that measure send a progress update as each run starts.
- `jankless` exports `improved()`, which says whether a check got better by more than its allowance, and the functions that word a result: `formatChange()`, `formatValue()`, `describeScript()`, `describeHotFunction()` and `describeBudget()`.
