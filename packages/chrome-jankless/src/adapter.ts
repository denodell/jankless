// The Chrome adapter for jankless's ad-hoc measurements: it starts the Chrome that's installed
// on this machine (or joins one that's already running), does the steps with Puppeteer's
// locators, and needs no test runner. The engine finds it as `chrome-jankless/adapter`.
import puppeteer, { type Browser, type KeyInput, type Page } from 'puppeteer-core';
import { TYPE_DELAY_MS, type Adapter, type AdapterBrowser, type LaunchOptions, type Step } from 'jankless';
import { ELEMENT_TIMEOUT_MS, puppeteerDriver, selectorTarget } from './driver.js';

export const PACKAGE_NAME = 'chrome-jankless';

/** The path of a Chrome or Chromium to run, in place of the installed Google Chrome. */
export const CHROME_PATH_ENV = 'JANKLESS_CHROME_PATH';
/** Extra command-line arguments for the Chrome that's started, separated by spaces. */
export const CHROME_ARGS_ENV = 'JANKLESS_CHROME_ARGS';
/** The address of a Chrome that's already running with remote debugging, such as http://127.0.0.1:9222. */
export const CHROME_URL_ENV = 'JANKLESS_CHROME_URL';

const CHANNELS = ['chrome', 'chrome-beta', 'chrome-dev', 'chrome-canary'] as const;
type Channel = (typeof CHANNELS)[number];

export interface ChromeAdapterOptions {
  /** A Chrome or Chromium executable. Default: `JANKLESS_CHROME_PATH`, then the installed Google Chrome. */
  executablePath?: string;
  /** A running Chrome to join, by its remote debugging address. Default: `JANKLESS_CHROME_URL`. */
  browserURL?: string;
  /**
   * Extra arguments for the Chrome that's started. Default: `JANKLESS_CHROME_ARGS`. A container
   * that runs as root needs `--no-sandbox`, which the adapter never adds by itself.
   */
  args?: string[];
}

const element = (page: Page, selector: string) => page.locator(selector).setTimeout(ELEMENT_TIMEOUT_MS);

/** Puppeteer's timeout says how long it waited, and not for what. */
async function withSelector<R>(what: string, selector: string, run: () => Promise<R>): Promise<R> {
  try {
    return await run();
  } catch (err) {
    if (!/Timed out|timeout/i.test((err as Error).message)) throw err;
    throw new Error(
      `Couldn't ${what} '${selector}': no element matching it was ready within ${ELEMENT_TIMEOUT_MS / 1000} seconds.`,
      { cause: err },
    );
  }
}

async function runSteps(page: Page, steps: Step[]): Promise<void> {
  for (const s of steps) {
    switch (s.action) {
      case 'click':
        await withSelector('click', s.selector, () => element(page, s.selector).click());
        break;
      case 'hover':
        await withSelector('hover over', s.selector, () => element(page, s.selector).hover());
        break;
      case 'type':
        if (s.selector) {
          const selector = s.selector;
          await withSelector('type into', selector, () => selectorTarget(page, selector).focus());
        }
        await page.keyboard.type(s.text, { delay: TYPE_DELAY_MS });
        break;
      case 'press':
        await page.keyboard.press(s.key as KeyInput);
        break;
      case 'wait':
        await new Promise((r) => setTimeout(r, s.ms));
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

function channelOf(channel: string | undefined): Channel {
  if (channel === undefined) return 'chrome';
  if ((CHANNELS as readonly string[]).includes(channel)) return channel as Channel;
  throw new Error(`${PACKAGE_NAME} runs ${CHANNELS.join(', ')}, not '${channel}'.`);
}

async function start(
  options: LaunchOptions,
  given: ChromeAdapterOptions,
): Promise<{ browser: Browser; joined: boolean }> {
  const viewport = { ...options.viewport, hasTouch: options.touch };
  const browserURL = given.browserURL ?? process.env[CHROME_URL_ENV];
  if (browserURL) {
    try {
      return { browser: await puppeteer.connect({ browserURL, defaultViewport: viewport }), joined: true };
    } catch (err) {
      throw new Error(
        `Couldn't join the Chrome at ${browserURL}: ${(err as Error).message}. Start Chrome with --remote-debugging-port and its own --user-data-dir.`,
        { cause: err },
      );
    }
  }
  const executablePath = given.executablePath ?? process.env[CHROME_PATH_ENV];
  try {
    const browser = await puppeteer.launch({
      // With a path, that Chrome is run. Otherwise the installed channel is found.
      ...(executablePath ? { executablePath } : { channel: channelOf(options.channel) }),
      // New headless mode, which draws frames as a headed browser does.
      headless: !options.headed,
      defaultViewport: viewport,
      args: given.args ?? (process.env[CHROME_ARGS_ENV] ?? '').split(/\s+/).filter(Boolean),
    });
    return { browser, joined: false };
  } catch (err) {
    throw new Error(launchFailure((err as Error).message), { cause: err });
  }
}

/** Why Chrome didn't start, with what to do about the two usual causes. */
export function launchFailure(message: string): string {
  if (/no-sandbox/.test(message)) {
    return `Couldn't start Chrome: it won't run as root with its sandbox. In a container, set ${CHROME_ARGS_ENV}=--no-sandbox.`;
  }
  const first = message.split('\n')[0]!.trim();
  return `Couldn't start Chrome: ${first}. ${PACKAGE_NAME} runs the Google Chrome installed on this machine; set ${CHROME_PATH_ENV} to another Chrome or Chromium to use that.`;
}

/** The adapter, with a Chrome chosen in code. The `adapter` export reads the environment. */
export function chromeAdapter(given: ChromeAdapterOptions = {}): Adapter {
  return {
    name: PACKAGE_NAME,
    async launch(options): Promise<AdapterBrowser> {
      const { browser, joined } = await start(options, given);
      // A Chrome that was already running is left running: only the tab opened here is closed.
      const context = joined ? null : browser.defaultBrowserContext();
      const close = async () => {
        if (joined) {
          await page.close().catch(() => undefined);
          await browser.disconnect();
        } else {
          await browser.close();
        }
      };
      let page: Page;
      try {
        page = await (context ?? browser).newPage();
      } catch (err) {
        await (joined ? browser.disconnect() : browser.close()).catch(() => undefined);
        throw err;
      }
      return {
        page: puppeteerDriver(page),
        open: (url) => open(page, url),
        runSteps: (steps) => runSteps(page, steps),
        element: (selector) => selectorTarget(page, selector),
        close,
      };
    },
  };
}

export const adapter: Adapter = chromeAdapter();
