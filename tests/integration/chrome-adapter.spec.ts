// The Chrome adapter end to end: the same ad-hoc measurements as the Playwright adapter makes,
// driven through puppeteer-core. It runs Playwright's Chromium build here, so the suite needs no
// Google Chrome installed; chrome-jankless itself has no Playwright in it.
import { test, expect, chromium } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { measureAdhoc, type AdhocRequest } from '../../packages/jankless/src/adhoc.js';
import { chromeAdapter } from '../../packages/chrome-jankless/src/adapter.js';

test.setTimeout(120_000);

// Playwright's Chromium build has no sandbox it can use on a Linux runner: it isn't installed
// with the permission an installed Google Chrome has, and it can't run as root either.
const args = process.platform === 'linux' ? ['--no-sandbox'] : [];
const executablePath = chromium.executablePath();
const adapter = chromeAdapter({ executablePath, args });

let dir: string;
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jankless-chrome-'));
});
test.afterEach(() => rmSync(dir, { recursive: true, force: true }));

const measure = (request: Omit<AdhocRequest, 'dir'>) =>
  measureAdhoc({ runs: 2, baseline: 'off', ...request, dir }, { adapter });

test('a click: input-to-paint, the long frame and the script behind it', async ({ baseURL }) => {
  const r = await measure({
    url: `${baseURL}/click.html?ms=150`,
    steps: [{ action: 'click', selector: '#heavy' }],
  });
  expect(r.verdict).toBe('measured');
  expect(r.result.unavailable).toEqual([]);
  expect(r.result.browserName).toBe('chromium');
  expect(r.result.headlessMode).toBe('new-headless');
  expect(r.result.runs).toBe(2);
  expect(r.result.longFrames!.count).toBe(1);
  expect(r.result.longFrames!.topScripts[0]).toMatchObject({ fn: 'onHeavyClick' });
  expect(r.result.input!.p95ToPaintMs).toBeGreaterThanOrEqual(150);
  expect(r.result.input!.byTarget[0]).toMatchObject({ target: 'button#heavy', event: 'click' });
});

test('full mode: a trace of the frames, and a CPU profile', async ({ baseURL }) => {
  const r = await measure({
    url: `${baseURL}/click.html?ms=150`,
    steps: [{ action: 'click', selector: '#heavy' }],
    mode: 'full',
  });
  expect(r.result.unavailable).toEqual([]);
  expect(r.result.frames!.dropped).toBeGreaterThan(0);
  // busyWait spins on performance.now(), which can be sampled as the hottest function itself.
  expect(r.result.profile!.hotFunctions.map((f) => f.fn)).toContain('busyWait');
});

test('a full-mode scroll of a list: frames and blank rows', async ({ baseURL }) => {
  const r = await measure({
    url: `${baseURL}/list.html`,
    scroll: { selector: '#list', distance: 2000 },
    mode: 'full',
  });
  expect(r.label).toBe('scroll #list 2000px on /list.html');
  expect(r.result.unavailable).toEqual([]);
  expect(r.result.scroll).toMatchObject({ input: 'wheel', scrolledPx: 2000 });
  expect(r.result.frames!.onTimePercent).not.toBeNull();
  expect(r.result.list!.blankFramePercent).not.toBeNull();
});

test('every kind of step, and a comparison with the baseline', async ({ baseURL }) => {
  const request = {
    url: `${baseURL}/search.html`,
    steps: [
      { action: 'hover', selector: '#search' },
      { action: 'type', selector: '#search', text: 'ab' },
      { action: 'press', key: 'Backspace' },
      { action: 'wait', ms: 50 },
    ],
    runs: 1,
  } satisfies Omit<AdhocRequest, 'dir'>;
  const first = await measureAdhoc({ ...request, dir }, { adapter });
  expect(first.verdict).toBe('baseline-recorded');
  // Two typed keys and the Backspace are three interactions.
  expect(first.result.input!.interactions).toBe(3);
  const again = await measureAdhoc({ ...request, dir }, { adapter });
  expect(['no-clear-change', 'better', 'worse']).toContain(again.verdict);
  expect(again.comparison!.baseline).not.toBeNull();
});

test("a selector that matches nothing fails with the selector, and Puppeteer's text selector works", async ({
  baseURL,
}) => {
  await expect(
    measure({ url: `${baseURL}/click.html?ms=20`, steps: [{ action: 'click', selector: '#nope' }], runs: 1 }),
  ).rejects.toThrow("Couldn't click '#nope': no element matching it was ready within 10 seconds.");

  const byText = await measure({
    url: `${baseURL}/click.html?ms=80`,
    steps: [{ action: 'click', selector: '::-p-text(Heavy click)' }],
    runs: 1,
  });
  expect(byText.result.input!.byTarget[0]).toMatchObject({ target: 'button#heavy' });
});

test('it joins a Chrome that is already running, and leaves it running', async ({ baseURL }) => {
  const running = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [...args, '--remote-debugging-port=0'],
  });
  try {
    const port = new URL(running.wsEndpoint()).port;
    const tabsBefore = (await running.pages()).length;
    const joined = chromeAdapter({ browserURL: `http://127.0.0.1:${port}` });
    const r = await measureAdhoc(
      {
        url: `${baseURL}/click.html?ms=150`,
        steps: [{ action: 'click', selector: '#heavy' }],
        runs: 1,
        baseline: 'off',
        dir,
      },
      { adapter: joined },
    );
    expect(r.result.longFrames!.count).toBe(1);
    expect(running.connected).toBe(true);
    // Its own tab is closed again.
    expect((await running.pages()).length).toBe(tabsBefore);
  } finally {
    await running.close();
  }
});

test('a Chrome that cannot be started or joined says what to do', async ({ baseURL }) => {
  const request = { url: `${baseURL}/click.html`, steps: [{ action: 'click', selector: '#heavy' }], dir };
  await expect(
    measureAdhoc(request as AdhocRequest, {
      adapter: chromeAdapter({ executablePath: join(dir, 'no-chrome-here') }),
    }),
  ).rejects.toThrow(/Couldn't start Chrome: .*set JANKLESS_CHROME_PATH to another Chrome or Chromium/);
  await expect(
    measureAdhoc(request as AdhocRequest, { adapter: chromeAdapter({ browserURL: 'http://127.0.0.1:9' }) }),
  ).rejects.toThrow(/Couldn't join the Chrome at http:\/\/127\.0\.0\.1:9: .*--remote-debugging-port/);
  await expect(
    measureAdhoc({ ...request, channel: 'firefox' } as AdhocRequest, { adapter: chromeAdapter({ args }) }),
  ).rejects.toThrow("chrome-jankless runs chrome, chrome-beta, chrome-dev, chrome-canary, not 'firefox'.");
});
