---
'playwright-butter': minor
'butter-churn': minor
'playwright-butter-mcp': minor
---

Measure a running page with no spec file.

- `npx playwright-butter measure <url>` takes steps (`--click`, `--hover`, `--type`, `--press`, `--wait`) or a `--scroll`, measures them the way `butter.measure()` and `butter.scroll()` do, and compares the result with the last baseline recorded under the same label. Its first line says whether the page is less smooth, smoother, or shows no clear change.
- `playwright-butter/adhoc` exports the same thing for scripts: `measureAdhoc()`, `remeasure()` and `validateRequest()`.
- `playwright-butter-mcp` is a new package: an MCP server with three tools for coding agents, `measure_interaction`, `compare_baseline` and `get_hot_functions`.
- `butter-churn` exports `improved()`, which says whether a check got better by more than its allowance, and the functions that word a result: `formatChange()`, `formatValue()`, `describeScript()`, `describeHotFunction()` and `describeBudget()`.
