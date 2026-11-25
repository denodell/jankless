import { test, expect } from '../../../packages/playwright-jankless/src/index.js';

test.use({
  janklessOptions: { runs: 3, enforce: process.env.ENFORCE === 'fail' ? 'fail' : 'warn' },
});

test('checkout click', async ({ page, jankless }) => {
  await page.goto(`/click.html?ms=${process.env.CLICK_MS}`);
  const result = await jankless.measure('checkout', () => page.click('#heavy'));
  expect(result).toBeSmooth();
});
