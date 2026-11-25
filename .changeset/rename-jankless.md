---
'playwright-jankless': minor
'jankless': minor
---

playwright-smoothness is now playwright-jankless, and smoothness-core is now jankless. To move over, install `playwright-jankless` in place of `playwright-smoothness`, then:

- import from `playwright-jankless`, and use `playwright-jankless/reporter` and `npx playwright-jankless`
- use `withJankless()` in place of `withSmoothness()`
- use the `jankless` fixture (`jankless.measure()`, `jankless.scroll()`) in place of `smoothness`
- set `janklessOptions` (typed with `JanklessTestOptions`) in place of `smoothnessOptions`
- use the `JanklessResult`, `JanklessOptions`, `JanklessMode`, `JanklessFixtures` and `Jankless` types in place of their `Smoothness` names
- set `JANKLESS_MODE`, `JANKLESS_BASELINE_DIR`, `JANKLESS_RECORD_BASELINES`, `JANKLESS_RECORD` and `JANKLESS_CALIBRATE` in place of their `SMOOTHNESS_` names
- use the GitHub Action as `denodell/jankless@v1`, or its `setup` and `report` steps
- look for `jankless-` annotations, results in `test-results/jankless`, baselines in `<spec>-snapshots/jankless`, the `jankless-baselines` artifact, and the automatic-mode history in `node_modules/.cache/playwright-jankless/history`

The old names no longer work. Baselines and histories recorded by playwright-smoothness aren't read, so each check records a new baseline on its first run, and `npx playwright-jankless init-agents` adds the skill under its new name. `toBeSmooth()` keeps its name.
