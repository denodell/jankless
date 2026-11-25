import { defineConfig } from '@playwright/test';
import type { JanklessTestOptions } from 'playwright-jankless';

export default defineConfig<JanklessTestOptions>({
  testDir: 'tests',
  // The jankless summary (test-results/jankless/summary.md, and the GitHub job summary).
  reporter: [['list'], ['playwright-jankless/reporter']],
  // A measurement is a warm-up plus several reloaded runs; a traced fast scroll through a list takes a while.
  timeout: 120_000,
  // Timing tests shouldn't compete with each other for the CPU.
  workers: 1,
  use: {
    baseURL: 'http://localhost:4180',
    browserName: 'chromium',
    channel: 'chromium', // new headless: closer to real Chrome than the headless shell
    janklessOptions: {
      // Baselines downloaded from main (see ../../docs/ci.md); unset locally.
      baselineDir: process.env.JANKLESS_BASELINE_DIR,
      enforce: process.env.JANKLESS_ENFORCE === 'fail' ? 'fail' : 'warn',
    },
  },
  webServer: {
    command: 'node server.mjs',
    url: 'http://localhost:4180',
    reuseExistingServer: !process.env.CI,
  },
});
