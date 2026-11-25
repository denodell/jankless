// Outside Chromium the measurement is skipped with a visible annotation.
import { test, expect } from '../../packages/playwright-jankless/src/index.js';

test('skipped outside Chromium', async ({ page, jankless }) => {
  await page.goto('/click.html?ms=20');
  const result = await jankless.measure('click', () => page.click('#heavy'));
  expect(result.browserName).not.toBe('chromium');
  expect(result.runs).toBe(0);
  expect(result.input).toBeNull();
  expect(result.longFrames).toBeNull();
  expect(result.unavailable.map((u) => u.measurement)).toEqual(['input', 'longFrames']);
  expect(test.info().annotations).toContainEqual({
    type: 'jankless-skipped',
    description: expect.stringContaining('Chromium only'),
  });
});
