// The Playwright adapter for jankless's ad-hoc measurements and command line: it opens
// Chromium, does the steps with Playwright's locators, and adds the commands that need
// Playwright. The engine finds it as `playwright-jankless/adapter`.
import { chromium, type Page } from '@playwright/test';
import { TYPE_DELAY_MS, type Adapter, type AdapterBrowser, type Step } from 'jankless';
import { commands } from './cli.js';
import { PACKAGE_NAME } from './constants.js';
import { locatorTarget, playwrightDriver } from './driver.js';

/** How long a step waits for its element. Shorter than Playwright's 30s: a wrong selector should fail soon. */
const STEP_TIMEOUT_MS = 10_000;

async function runSteps(page: Page, steps: Step[]): Promise<void> {
  for (const s of steps) {
    switch (s.action) {
      case 'click':
        await page.locator(s.selector).click();
        break;
      case 'hover':
        await page.locator(s.selector).hover();
        break;
      case 'type':
        if (s.selector) await page.locator(s.selector).pressSequentially(s.text, { delay: TYPE_DELAY_MS });
        else await page.keyboard.type(s.text, { delay: TYPE_DELAY_MS });
        break;
      case 'press':
        await page.keyboard.press(s.key);
        break;
      case 'wait':
        await page.waitForTimeout(s.ms);
        break;
    }
  }
}

/** Without its hash: two URLs that only differ there are the same document. */
const documentOf = (url: string) => url.replace(/#.*$/, '');

/**
 * Loads the URL from scratch. Going to the URL the page is already on, or to one that differs
 * only in its hash, doesn't load a new document, so those are reloaded.
 */
async function open(page: Page, url: string): Promise<void> {
  const before = page.url();
  if (before !== url) await page.goto(url, { waitUntil: 'load' });
  if (documentOf(before) === documentOf(url)) await page.reload({ waitUntil: 'load' });
}

export const adapter: Adapter = {
  name: PACKAGE_NAME,
  commands,
  async launch(options): Promise<AdapterBrowser> {
    // The `chromium` channel runs new headless mode, which draws frames as a headed browser does.
    const browser = await chromium.launch({
      channel: options.channel ?? 'chromium',
      headless: !options.headed,
    });
    try {
      const context = await browser.newContext({ viewport: options.viewport, hasTouch: options.touch });
      const page = await context.newPage();
      page.setDefaultTimeout(STEP_TIMEOUT_MS);
      return {
        page: playwrightDriver(page),
        open: (url) => open(page, url),
        runSteps: (steps) => runSteps(page, steps),
        element: (selector) => locatorTarget(page.locator(selector)),
        close: () => browser.close(),
      };
    } catch (err) {
      await browser.close();
      throw err;
    }
  },
};
