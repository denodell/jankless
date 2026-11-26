// Full mode's CPU profile: attributed to the page's main thread only, and to the interaction.
import { test, expect } from '../../packages/playwright-jankless/src/index.js';

test.use({ janklessOptions: { mode: 'full', runs: 2 } });

// busyWait spins on performance.now(), so the profiler sometimes gives more self time to the
// browser's own `now` than to busyWait. A built-in function has no URL, so these tests check the
// hottest function that comes from a script.
const fromScripts = <T extends { url: string }>(fns: T[]) => fns.filter((f) => f.url !== '');

test('a busy web worker is never blamed for the main thread', async ({ page, jankless }) => {
  await page.goto('/worker.html?ms=150');
  await page.waitForTimeout(300);
  const result = await jankless.measure('click next to a busy worker', () => page.click('#heavy'));
  const fns = result.profile!.hotFunctions.map((f) => f.fn);
  expect(fns).not.toContain('workerSpin');
  const top = fromScripts(result.profile!.hotFunctions)[0]!;
  expect(top.fn).toBe('busyWait');
  expect(top.callers[0]).toBe('onHeavyClick');
});

test('hot functions carry location, self and total time', async ({ page, jankless }) => {
  await page.goto('/click.html?ms=150');
  const result = await jankless.measure('profiled click', () => page.click('#heavy'));
  const top = fromScripts(result.profile!.hotFunctions)[0]!;
  expect(top).toMatchObject({
    fn: 'busyWait',
    url: expect.stringMatching(/\/lib\/work\.js$/),
    callers: ['onHeavyClick'],
  });
  expect(top.line).toBeGreaterThan(0);
  expect(top.totalMs).toBeGreaterThanOrEqual(top.selfMs);
  expect(result.profile!.sampledMs).toBeGreaterThan(100);
});

test('quick mode has no profile', async ({ page, jankless }) => {
  await page.goto('/click.html?ms=60');
  const result = await jankless.measure('quick click', () => page.click('#heavy'), {
    mode: 'quick',
    runs: 1,
  });
  expect('profile' in result).toBe(false);
});
