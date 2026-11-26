---
'playwright-jankless': minor
'jankless': minor
'jankless-mcp': minor
---

The engine has the command line and the ad-hoc measurements, and the MCP server no longer depends on Playwright.

- `jankless` has the `jankless` command: `npx jankless measure <url>`, `summary` and `brief`. `npx playwright-jankless` runs the same commands, and adds `calibrate` and `init-agents`.
- `measureAdhoc()`, `remeasure()` and `validateRequest()` are exported from `jankless/adhoc`, in place of `playwright-jankless/adhoc`.
- Measuring a URL goes through a browser adapter, which the engine finds in the project it runs in. `playwright-jankless` is one, exported as `playwright-jankless/adapter`, and `jankless` exports the `Adapter` types and `loadAdapter()` for writing another.
- `jankless-mcp` no longer depends on `playwright-jankless`. It measures through an installed adapter, as the command does.
