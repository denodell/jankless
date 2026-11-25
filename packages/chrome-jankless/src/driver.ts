// The Chrome adapter's driver: a PageDriver for a Puppeteer page and an ElementTarget for a
// selector, over puppeteer-core. No browser is downloaded: it drives the Chrome that's installed.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Browser, KeyInput, Page } from 'puppeteer-core';
import {
  detectHeadlessMode,
  type BrowserEnvironment,
  type CdpSession,
  type ElementTarget,
  type Evaluate,
  type FetchText,
  type PageDriver,
  type ScratchPage,
} from 'jankless';

/** How long one script or source map fetch may take. */
const FETCH_TIMEOUT_MS = 10_000;

/** How long a step or a scroll waits for its element. A wrong selector should fail soon. */
export const ELEMENT_TIMEOUT_MS = 10_000;

/** The origin a secure scratch page is served from. The adapter answers it itself. */
const SCRATCH_URL = 'http://localhost/__jankless-scratch';

const environments = new WeakMap<Browser, Promise<BrowserEnvironment>>();

/** The browser's name, version and headless mode, read once per browser. */
export function browserEnvironment(browser: Browser): Promise<BrowserEnvironment> {
  let env = environments.get(browser);
  if (!env) {
    env = readEnvironment(browser);
    environments.set(browser, env);
  }
  return env;
}

async function readEnvironment(browser: Browser): Promise<BrowserEnvironment> {
  try {
    const cdp = await browser.target().createCDPSession();
    try {
      const version = (await cdp.send('Browser.getVersion')) as { product?: string; userAgent?: string };
      return {
        browserName: 'chromium',
        browserVersion: (version.product ?? '').replace(/^[^/]*\//, '') || 'unknown',
        headlessMode: detectHeadlessMode(version),
      };
    } finally {
      await cdp.detach().catch(() => undefined);
    }
  } catch {
    return { browserName: 'chromium', browserVersion: 'unknown', headlessMode: 'unknown' };
  }
}

// Puppeteer's evaluate types are richer than the engine needs; the engine only passes
// serializable arguments.
const evaluateOn =
  (page: Page): Evaluate =>
  (fn, arg) =>
    page.evaluate(fn as never, arg as never) as never;

/**
 * Fetches scripts and source maps with the page's cookies for that URL, so a page behind a
 * sign-in still gets its maps. `file:` URLs are read from disk.
 */
export function pageFetcher(page: Page): FetchText {
  return async (url) => {
    if (url.startsWith('file:')) return { text: await readFile(fileURLToPath(url), 'utf8') };
    const cookies = await page
      .browserContext()
      .cookies()
      .catch(() => []);
    const host = new URL(url).hostname;
    const cookie = cookies
      .filter(
        (c) =>
          host === c.domain.replace(/^\./, '') ||
          host.endsWith(c.domain.startsWith('.') ? c.domain : `.${c.domain}`),
      )
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
    const response = await fetch(url, {
      headers: cookie ? { cookie } : {},
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    const header = response.headers.get('sourcemap') ?? response.headers.get('x-sourcemap');
    return { text: await response.text(), ...(header ? { sourceMapHeader: header } : {}) };
  };
}

export function puppeteerDriver(page: Page): PageDriver {
  const browser = page.browser();
  return {
    native: page,
    environment: () => browserEnvironment(browser),
    evaluate: evaluateOn(page),
    addInitScript: async (fn, arg) => {
      await page.evaluateOnNewDocument(fn as never, arg as never);
    },
    reload: async () => {
      await page.reload({ waitUntil: 'load' });
    },
    viewport: () => {
      const v = page.viewport();
      return v ? { width: v.width, height: v.height } : null;
    },
    screenshot: async (clip) =>
      Buffer.from(await page.screenshot({ clip, type: 'png', captureBeyondViewport: false })),
    click: (x, y) => page.mouse.click(x, y),
    press: (key) => page.keyboard.press(key as KeyInput),
    cdp: async (): Promise<CdpSession> => {
      const session = await page.createCDPSession();
      return {
        send: (method, params) => session.send(method as never, params as never),
        on: (event, handler) => void session.on(event as never, handler),
        off: (event, handler) => void session.off(event as never, handler),
        detach: () => session.detach(),
      };
    },
    fetchText: pageFetcher(page),
    tracer: () => ({
      start: (categories, { screenshots }) => page.tracing.start({ categories, screenshots }),
      stop: async () => Buffer.from((await page.tracing.stop()) ?? []),
    }),
    openScratchPage: ({ secure }) => openScratch(browser, secure),
  };
}

async function openScratch(browser: Browser, secure: boolean): Promise<ScratchPage> {
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    if (secure) {
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (request.url() === SCRATCH_URL) {
          void request.respond({ contentType: 'text/html', body: '<!doctype html><title>scratch</title>' });
        } else {
          void request.continue();
        }
      });
      await page.goto(SCRATCH_URL);
    }
    return { evaluate: evaluateOn(page), close: () => context.close() };
  } catch (err) {
    await context.close().catch(() => undefined);
    throw err;
  }
}

/**
 * An element by its selector, found again on every call, since each run reloads the page.
 * Selectors are Puppeteer's: CSS, and its `::-p-text(Save)`, `::-p-aria(Save)` and
 * `::-p-xpath(...)` forms.
 */
export function selectorTarget(page: Page, selector: string): ElementTarget {
  const withElement = async <R>(use: (el: import('puppeteer-core').ElementHandle<Element>) => Promise<R>) => {
    const handle = await page.locator(selector).setTimeout(ELEMENT_TIMEOUT_MS).waitHandle();
    try {
      return await use(handle);
    } finally {
      await handle.dispose().catch(() => undefined);
    }
  };
  return {
    description: `locator('${selector}')`,
    evaluate: (fn, arg) => withElement((el) => el.evaluate(fn as never, arg as never) as never),
    scrollIntoView: () => withElement((el) => el.scrollIntoView()),
    focus: () => withElement((el) => el.focus()),
  };
}
