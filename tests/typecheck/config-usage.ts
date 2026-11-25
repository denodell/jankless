// Compile-only: the config usage shown in README and docs/ci.md must typecheck.
import { defineConfig } from '@playwright/test';
import type { JanklessTestOptions } from '../../packages/playwright-jankless/src/index.js';

export const plain = defineConfig({
  use: { channel: 'chromium' },
});

export const withOptions = defineConfig<JanklessTestOptions>({
  use: {
    channel: 'chromium',
    janklessOptions: { baselineDir: process.env.JANKLESS_BASELINE_DIR, enforce: 'fail' },
  },
});
