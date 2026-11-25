// Ad-hoc checks: a URL and a list of steps, measured with no spec file. The CLI's `measure`
// command and the jankless-mcp server both run through here.
import { chromium, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import {
  checkBudget,
  defaultScrollLabel,
  describeBudget,
  describeHotFunction,
  describeScript,
  evaluate,
  formatChange,
  formatValue,
  improved,
  measure,
  measureScroll,
  missedBudget,
  preparePage,
  resolveOptions,
  resolveScroll,
  resultPath,
  validateBudget,
  writeResult,
  type BaselineTarget,
  type Budget,
  type JanklessMode,
  type JanklessResult,
  type Check,
  type Comparison,
  type ElementTarget,
  type MeasureContext,
  type ScrollOptions,
} from 'jankless';
import { locatorTarget, playwrightDriver } from './driver.js';
import { filesEndingIn, readResults } from './results.js';

/** One thing done to the page. Steps run in order. */
export type Step =
  | { action: 'click'; selector: string }
  | { action: 'hover'; selector: string }
  /** Types one key at a time, into `selector` when given, otherwise into the focused element. */
  | { action: 'type'; text: string; selector?: string }
  /** A key by its `KeyboardEvent.key` name, such as `Enter` or `ArrowDown`. */
  | { action: 'press'; key: string }
  | { action: 'wait'; ms: number };

/** A scroll to measure instead of steps, with the same options as `jankless.scroll()`. */
export interface AdhocScroll extends Omit<ScrollOptions, 'label'> {
  /** The list to scroll. Default `html`, the page itself. */
  selector?: string;
}

/**
 * `'compare'` (default) compares with the stored baseline and records one when there is none,
 * `'record'` replaces it with this result, and `'off'` only measures.
 */
export type BaselineUse = 'compare' | 'record' | 'off';

export interface AdhocRequest {
  /** An http:, https: or file: URL. */
  url: string;
  /** The interaction to measure. Give this or `scroll`. */
  steps?: Step[];
  /** The scroll to measure. Give this or `steps`. */
  scroll?: AdhocScroll;
  /** Steps run after each page load and before measuring, such as opening the panel to measure in. */
  setup?: Step[];
  /** Names the baseline. Default: built from the URL's path and the steps. */
  label?: string;
  mode?: JanklessMode;
  runs?: number;
  cpuThrottling?: number;
  maxIncrease?: number;
  /** Fixed limits, checked on every run, including the first. */
  budget?: Budget;
  baseline?: BaselineUse;
  /** Where baselines and results are kept. Default: `defaultAdhocDir()`. */
  dir?: string;
  /** Show the browser window. */
  headed?: boolean;
  viewport?: { width: number; height: number };
  /** A touch-enabled page. Enabled automatically for `scroll.input: 'touch'`. */
  touch?: boolean;
  /** The browser channel. Default `chromium`, which runs new headless mode. */
  channel?: string;
}

/**
 * - `worse`: a check is past its allowance.
 * - `better`: nothing is worse, and a check improved by more than its allowance.
 * - `no-clear-change`: every check moved less than its allowance, which can be noise.
 * - `baseline-recorded`: this result became the baseline.
 * - `not-compared`: nothing could be compared, and the text says why.
 * - `measured`: `baseline: 'off'`.
 */
export type Verdict =
  'worse' | 'better' | 'no-clear-change' | 'baseline-recorded' | 'not-compared' | 'measured';

export interface AdhocOutcome {
  label: string;
  verdict: Verdict;
  /** Null when no budget was given. */
  budget: 'met' | 'missed' | null;
  /** The result, with its comparison, as written to `resultFile`. */
  result: JanklessResult;
  comparison: Comparison | null;
  /** The outcome in a few lines: the verdict, the numbers, then the code behind them. */
  text: string;
  resultFile: string;
}

const STEP_ACTIONS = ['click', 'hover', 'type', 'press', 'wait'] as const;
const BASELINE_USES: BaselineUse[] = ['compare', 'record', 'off'];
const PROTOCOLS = ['http:', 'https:', 'file:'];

/** The longest one `wait` step may be. */
export const MAX_WAIT_MS = 30_000;
/** How long a step waits for its element. Shorter than Playwright's 30s: a wrong selector should fail soon. */
const STEP_TIMEOUT_MS = 10_000;
/** Time between typed keys: slow enough for each key to paint, so each is its own interaction. */
const TYPE_DELAY_MS = 100;
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
/** Dev servers don't watch node_modules, so writing here doesn't reload the page being measured. */
const CACHE_SUBDIR = '.cache/playwright-jankless/adhoc';
const RECIPE_KIND = 'playwright-jankless-recipe';
/** How many scripts and functions the text names. */
const TEXT_ITEMS = 3;

const fail = (message: string): never => {
  throw new Error(`jankless measure: ${message}`);
};

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function text(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

function validateSteps(steps: unknown, name: string): Step[] {
  if (!Array.isArray(steps)) return fail(`${name} must be a list of steps.`);
  return steps.map((raw, i): Step => {
    const at = `${name}[${i}]`;
    if (!isObject(raw)) return fail(`${at} must be an object with an action.`);
    const s = raw;
    switch (s.action) {
      case 'click':
      case 'hover':
        if (!text(s.selector)) fail(`${at}: a ${s.action} step needs a selector.`);
        return { action: s.action, selector: s.selector as string };
      case 'type':
        if (typeof s.text !== 'string' || s.text === '') fail(`${at}: a type step needs text.`);
        if (s.selector !== undefined && !text(s.selector))
          fail(`${at}: a type step's selector must be a non-empty string.`);
        return {
          action: 'type',
          text: s.text as string,
          ...(s.selector ? { selector: s.selector as string } : {}),
        };
      case 'press':
        if (!text(s.key)) fail(`${at}: a press step needs a key, such as Enter.`);
        return { action: 'press', key: s.key as string };
      case 'wait':
        if (typeof s.ms !== 'number' || !(s.ms >= 0) || s.ms > MAX_WAIT_MS)
          fail(`${at}: a wait step needs ms, from 0 to ${MAX_WAIT_MS}.`);
        return { action: 'wait', ms: s.ms as number };
      default:
        return fail(`${at}: unknown action '${String(s.action)}'. Use ${STEP_ACTIONS.join(', ')}.`);
    }
  });
}

/**
 * Checks a request and fills in nothing: every mistake is reported before a browser opens.
 * The URL comes back in its normalized form.
 */
export function validateRequest(input: unknown): AdhocRequest {
  if (!isObject(input)) return fail('the request must be an object.');
  const r = input as Partial<AdhocRequest>;
  if (!text(r.url)) fail('a URL is needed.');
  let url: URL;
  try {
    url = new URL(r.url!);
  } catch {
    return fail(`'${r.url}' isn't a URL. Give the whole address, such as http://localhost:5173/list.`);
  }
  if (!PROTOCOLS.includes(url.protocol))
    fail(`only http, https and file URLs are opened, not ${url.protocol}`);

  const hasSteps = r.steps !== undefined;
  const hasScroll = r.scroll !== undefined;
  if (hasSteps === hasScroll) fail('give either steps or a scroll to measure.');
  const steps = hasSteps ? validateSteps(r.steps, 'steps') : undefined;
  if (steps && steps.length === 0) fail('steps is empty: there is nothing to measure.');
  if (steps && steps.every((s) => s.action === 'wait')) {
    fail('steps only waits. Add a click, hover, type or press to measure.');
  }
  const setup = r.setup === undefined ? undefined : validateSteps(r.setup, 'setup');

  let scroll: AdhocScroll | undefined;
  if (hasScroll) {
    const given: unknown = r.scroll;
    if (!isObject(given)) return fail('scroll must be an object.');
    const { selector, distance, direction, input: scrollInput, speed } = given as AdhocScroll;
    if (selector !== undefined && !text(selector)) fail("scroll's selector must be a non-empty string.");
    if (direction !== undefined && direction !== 'vertical' && direction !== 'horizontal')
      fail(`scroll's direction must be vertical or horizontal, got '${String(direction)}'.`);
    if (scrollInput !== undefined && !['wheel', 'touch', 'keys'].includes(scrollInput))
      fail(`scroll's input must be wheel, touch or keys, got '${String(scrollInput)}'.`);
    scroll = { selector, distance, direction, input: scrollInput, speed };
    resolveScroll(scroll); // distance and speed
  }

  if (r.label !== undefined && !text(r.label)) fail('label must be a non-empty string.');
  if (r.baseline !== undefined && !BASELINE_USES.includes(r.baseline))
    fail(`baseline must be ${BASELINE_USES.join(', ')}, got '${String(r.baseline)}'.`);
  if (r.budget !== undefined) {
    if (!isObject(r.budget)) fail('budget must be an object, such as {"maxLongFrames": 0}.');
    validateBudget(r.budget);
  }
  if (r.viewport !== undefined) {
    const v = r.viewport;
    if (!isObject(v) || !(Number(v.width) > 0) || !(Number(v.height) > 0))
      fail('viewport needs a width and a height in pixels.');
  }
  if (r.mode !== undefined && r.mode !== 'quick' && r.mode !== 'full')
    fail(`mode must be quick or full, got '${String(r.mode)}'.`);
  resolveOptions([optionsOf(r as AdhocRequest)]); // runs, cpuThrottling, maxIncrease

  const out: AdhocRequest = { ...(r as AdhocRequest), url: url.href };
  if (steps) out.steps = steps;
  if (setup) out.setup = setup;
  if (scroll) out.scroll = scroll;
  return out;
}

function optionsOf(r: AdhocRequest) {
  return {
    ...(r.mode !== undefined ? { mode: r.mode } : {}),
    ...(r.runs !== undefined ? { runs: r.runs } : {}),
    ...(r.cpuThrottling !== undefined ? { cpuThrottling: r.cpuThrottling } : {}),
    ...(r.maxIncrease !== undefined ? { maxIncrease: r.maxIncrease } : {}),
  };
}

function describeStep(s: Step): string {
  switch (s.action) {
    case 'click':
    case 'hover':
      return `${s.action} ${s.selector}`;
    case 'type':
      return s.selector ? `type "${s.text}" into ${s.selector}` : `type "${s.text}"`;
    case 'press':
      return `press ${s.key}`;
    case 'wait':
      return `wait ${s.ms}ms`;
  }
}

/** `click #open, press Enter on /checkout?step=2`: the same request always gets the same label. */
export function defaultLabel(r: AdhocRequest): string {
  const url = new URL(r.url);
  const where = url.protocol === 'file:' ? basename(url.pathname) : `${url.pathname}${url.search}`;
  const what = r.scroll
    ? defaultScrollLabel(
        { description: r.scroll.selector ?? 'html' } as ElementTarget,
        resolveScroll(r.scroll),
      )
    : (r.steps ?? []).map(describeStep).join(', ');
  return `${what} on ${where}`;
}

/**
 * Where baselines and results are kept by default: in the nearest node_modules, which dev
 * servers don't watch, and otherwise in the system's temporary folder, in a folder of this project's own.
 */
export function defaultAdhocDir(cwd = process.cwd()): string {
  const start = resolve(cwd);
  for (let d = start; ; d = dirname(d)) {
    const modules = join(d, 'node_modules');
    if (existsSync(modules) && statSync(modules).isDirectory()) return join(modules, CACHE_SUBDIR);
    if (existsSync(join(d, '.git')) || dirname(d) === d) break;
  }
  const id = createHash('sha256').update(start).digest('hex').slice(0, 12);
  return join(tmpdir(), 'playwright-jankless-adhoc', id);
}

const resultsDir = (dir: string) => join(dir, 'results');
const recipePath = (dir: string, label: string) =>
  resultPath(resultsDir(dir), label).replace(/\.json$/, '.recipe.json');

function baselineTarget(dir: string, use: BaselineUse): BaselineTarget {
  const root = join(dir, 'baselines');
  return {
    path: (fileName) => join(root, fileName),
    root,
    project: 'adhoc',
    update: use === 'record' ? 'all' : 'missing',
    describeUpdate: () => "baseline: 'record'",
  };
}

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
 * Loads the URL again from scratch. Going to the URL the page is already on, or to one that
 * differs only in its hash, doesn't load a new document, so those are reloaded.
 */
async function reopen(page: Page, url: string): Promise<void> {
  const before = page.url();
  if (before !== url) await page.goto(url, { waitUntil: 'load' });
  if (documentOf(before) === documentOf(url)) await page.reload({ waitUntil: 'load' });
}

/** Called while a measurement runs, to report how far along it is. */
export interface AdhocHooks {
  /** Before each run starts. `run` counts from 1, and the first run is the warm-up. */
  onRun?: (progress: { run: number; total: number; warmUp: boolean }) => void;
}

/**
 * Opens the URL in Chromium, measures the steps or the scroll the way `jankless.measure()` and
 * `jankless.scroll()` do, and compares the result with this label's baseline. The result and
 * the request are saved, so `remeasure()` can run the same check again by its label.
 */
export async function measureAdhoc(input: AdhocRequest, hooks: AdhocHooks = {}): Promise<AdhocOutcome> {
  const request = validateRequest(input);
  const dir = resolve(request.dir ?? defaultAdhocDir());
  const use = request.baseline ?? 'compare';
  const label = request.label ?? defaultLabel(request);
  const setup = request.setup ?? [];
  // A touch scroll needs a touch-enabled page, whatever `touch` says.
  const touch = request.touch === true || request.scroll?.input === 'touch';

  const browser = await chromium.launch({
    channel: request.channel ?? 'chromium',
    headless: !request.headed,
  });
  let result: JanklessResult;
  try {
    const context = await browser.newContext({
      viewport: request.viewport ?? DEFAULT_VIEWPORT,
      hasTouch: touch,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT_MS);
    const driver = playwrightDriver(page);
    await preparePage(driver);
    await page.goto(request.url, { waitUntil: 'load' });
    await runSteps(page, setup);

    const options = resolveOptions<Page>([
      {
        ...optionsOf(request),
        // There's no report to attach a replay to.
        replay: 'off',
        reset: async ({ page: p }) => {
          await reopen(p, request.url);
          await runSteps(p, setup);
        },
      },
    ]);
    // Ad-hoc baselines are kept in `dir` only; JANKLESS_BASELINE_DIR is for the test suite's.
    options.baselineDir = undefined;
    const ctx: MeasureContext = {
      page: driver,
      label,
      options,
      environment: await driver.environment(),
      beforeRun: async (run) => {
        // Run 0 is the warm-up. A hook that throws mustn't stop the measurement.
        try {
          hooks.onRun?.({ run: run + 1, total: options.runs + 1, warmUp: run === 0 });
        } catch {
          // ignored
        }
      },
    };
    result = request.scroll
      ? await measureScroll(
          ctx,
          locatorTarget(page.locator(request.scroll.selector ?? 'html')),
          resolveScroll(request.scroll),
        )
      : await measure(ctx, () => runSteps(page, request.steps!));
  } finally {
    await browser.close();
  }

  let comparison: Comparison | null = null;
  if (use !== 'off') {
    comparison = evaluate(result, baselineTarget(dir, use), { budget: request.budget });
  } else if (request.budget && result.runs > 0) {
    comparison = {
      status: 'not-compared',
      checks: [],
      baseline: null,
      notes: [],
      budget: checkBudget(result, request.budget),
    };
  }
  if (comparison) result.comparison = comparison;

  const resultFile = resultPath(resultsDir(dir), label);
  writeResult(result, resultFile);
  // The folder isn't part of the recipe: it's where the recipe is.
  const recipe: AdhocRequest = { ...request, label };
  delete recipe.dir;
  writeFileSync(
    recipePath(dir, label),
    JSON.stringify({ schemaVersion: 1, kind: RECIPE_KIND, request: recipe }, null, 2) + '\n',
  );

  const verdict = verdictOf(comparison, use);
  const budget = comparison?.budget ? (missedBudget(comparison).length ? 'missed' : 'met') : null;
  const outcome = { label, verdict, budget, result, comparison, resultFile } as const;
  return { ...outcome, text: formatOutcome(outcome) };
}

function verdictOf(comparison: Comparison | null, use: BaselineUse): Verdict {
  if (!comparison || use === 'off') return 'measured';
  switch (comparison.status) {
    case 'warn':
    case 'fail':
      return 'worse';
    case 'baseline-created':
    case 'baseline-updated':
      return 'baseline-recorded';
    case 'not-compared':
      return 'not-compared';
    case 'pass':
      return comparison.checks.some(improved) ? 'better' : 'no-clear-change';
  }
}

/** The request a label was last measured with, or null when it never was. */
export function readRecipe(label: string, dir = defaultAdhocDir()): AdhocRequest | null {
  const path = recipePath(resolve(dir), label);
  if (!existsSync(path)) return null;
  try {
    const file = JSON.parse(readFileSync(path, 'utf8')) as { kind?: string; request?: AdhocRequest };
    return file.kind === RECIPE_KIND && file.request ? file.request : null;
  } catch {
    return null;
  }
}

/** A label's last ad-hoc result, or null when it was never measured. */
export function readLastResult(label: string, dir = defaultAdhocDir()): JanklessResult | null {
  const path = resultPath(resultsDir(resolve(dir)), label);
  if (!existsSync(path)) return null;
  try {
    const result = JSON.parse(readFileSync(path, 'utf8')) as JanklessResult;
    return result.schemaVersion === 1 && result.label === label ? result : null;
  } catch {
    return null;
  }
}

/** Where a label's last result came from: an ad-hoc measurement, or a test in the last Playwright run. */
export interface FoundResult {
  result: JanklessResult;
  source: 'adhoc' | 'test';
}

/**
 * A label's last result: the ad-hoc one when there is one, and otherwise the result with that
 * label, or from the test with that title, in the last Playwright run (`results` is its output
 * folder, `test-results` by default).
 */
export function findResult(
  label: string,
  where: { dir?: string; results?: string } = {},
): FoundResult | null {
  const adhoc = readLastResult(label, where.dir);
  if (adhoc) return { result: adhoc, source: 'adhoc' };
  const entries = readResults(where.results ?? 'test-results');
  const wanted = label.trim().toLowerCase();
  const found =
    entries.find((e) => e.result.label.toLowerCase() === wanted) ??
    entries.find((e) => e.test.toLowerCase() === wanted);
  return found ? { result: found.result, source: 'test' } : null;
}

/**
 * Measures a label again with the request it was last measured with, and compares it with its
 * baseline: what to run after each change while working on a fix. `baseline: 'record'`
 * replaces the baseline instead.
 */
export async function remeasure(
  label: string,
  overrides: { dir?: string; baseline?: BaselineUse } = {},
  hooks: AdhocHooks = {},
): Promise<AdhocOutcome> {
  const dir = overrides.dir ?? defaultAdhocDir();
  const recipe = readRecipe(label, dir);
  if (!recipe) {
    return fail(`"${label}" hasn't been measured yet, so there's nothing to run again. Measure it first.`);
  }
  return measureAdhoc({ ...recipe, dir, baseline: overrides.baseline ?? 'compare' }, hooks);
}

/** A result's own numbers, one per line, for a result with no baseline to compare with. */
function numberLines(result: JanklessResult): string[] {
  const lines: string[] = [];
  const top = result.input?.byTarget[0];
  if (result.input?.p95ToPaintMs != null) {
    const slowest = top ? `, slowest: ${top.event} on ${top.target}` : '';
    lines.push(`input-to-paint (p95) ${formatValue(result.input.p95ToPaintMs, 'ms')}${slowest}`);
  } else if (result.input && !result.scroll) {
    lines.push('input-to-paint: every interaction painted in under 16ms');
  }
  if (result.longFrames) {
    const f = result.longFrames;
    const worst = f.worstMs === null ? '' : ` (the longest ${formatValue(f.worstMs, 'ms')})`;
    lines.push(`long frames ${f.count}${worst}`);
  }
  if (result.frames && result.frames.onTimePercent !== null) {
    const f = result.frames;
    lines.push(`frames on time ${formatValue(f.onTimePercent, '%')} (${f.dropped} of ${f.total} dropped)`);
  }
  if (result.list) {
    const l = result.list;
    lines.push(
      `blank list frames ${formatValue(l.blankFramePercent, '%')} (the emptiest frame ${formatValue(l.leastDrawnPercent, '%')} drawn)`,
    );
  }
  return lines;
}

function checkLine(result: JanklessResult, c: Check): string {
  const top = result.input?.byTarget[0];
  const slowest =
    c.metric.startsWith('input.') && top && c.current !== null
      ? `, slowest: ${top.event} on ${top.target}`
      : '';
  const reason = c.status === 'unavailable' || c.status === 'not-compared' ? `: ${c.reason}` : '';
  return `${c.name} ${formatChange(c)}${slowest}${reason}`;
}

/**
 * The outcome as text, for a person or a coding agent: the verdict first, then the numbers,
 * then the scripts and functions behind them.
 */
export function formatOutcome(o: Omit<AdhocOutcome, 'text'>): string {
  const { result, comparison, verdict } = o;
  const lines: string[] = [];
  const indent = (items: string[]) => items.map((l) => `  ${l}`);
  const checks = comparison?.checks ?? [];
  const worse = checks.filter((c) => c.status === 'worse');
  const better = checks.filter(improved);
  const rest = checks.filter((c) => !worse.includes(c) && !better.includes(c));
  const within = `${Math.round(result.settings.maxIncrease * 1000) / 10}%`;

  switch (verdict) {
    case 'worse':
      lines.push(
        `"${o.label}" is less smooth than its baseline:`,
        ...indent(worse.map((c) => checkLine(result, c))),
      );
      if (better.length) lines.push('Better:', ...indent(better.map((c) => checkLine(result, c))));
      if (rest.length) lines.push('No clear change:', ...indent(rest.map((c) => checkLine(result, c))));
      break;
    case 'better':
      lines.push(
        `"${o.label}" is smoother than its baseline:`,
        ...indent(better.map((c) => checkLine(result, c))),
      );
      if (rest.length) lines.push('No clear change:', ...indent(rest.map((c) => checkLine(result, c))));
      break;
    case 'no-clear-change':
      lines.push(
        `"${o.label}": no clear change from its baseline. Every number moved less than ${within}, which can be noise.`,
        ...indent(rest.map((c) => checkLine(result, c))),
      );
      break;
    case 'baseline-recorded':
      lines.push(
        `"${o.label}": baseline recorded. Measure it again after a change to compare.`,
        ...indent(numberLines(result)),
      );
      break;
    case 'measured':
      lines.push(`"${o.label}": measured, and not compared with a baseline.`, ...indent(numberLines(result)));
      break;
    case 'not-compared':
      lines.push(`"${o.label}": not compared with a baseline.`, ...indent(numberLines(result)));
      break;
  }

  if (comparison?.budget?.length) {
    const missed = missedBudget(comparison);
    lines.push('');
    if (missed.length) lines.push('Missed its budget:', ...indent(missed.map(describeBudget)));
    else lines.push('Within its budget.');
  }

  const scripts = result.longFrames?.topScripts.slice(0, TEXT_ITEMS) ?? [];
  if (scripts.length) {
    lines.push('', 'Scripts in the long frames:');
    scripts.forEach((s, i) => lines.push(`  ${i + 1}. ${describeScript(s)}`));
  }
  const hot = result.profile?.hotFunctions.slice(0, TEXT_ITEMS) ?? [];
  if (hot.length) {
    lines.push('', 'Where the CPU time went:');
    hot.forEach((f, i) => lines.push(`  ${i + 1}. ${describeHotFunction(f)}`));
  }

  for (const c of checks.filter((k) => k.noisy)) {
    lines.push(
      '',
      `Noise: ${c.name} varied ${c.spreadPercent}% across ${result.runs} runs, more than the ${within} allowed, so a change this size can be noise.`,
    );
  }
  const unavailable = result.unavailable.filter(
    (u) => !checks.some((c) => c.status === 'unavailable' && c.reason === u.reason),
  );
  if (unavailable.length) {
    lines.push('', 'Unavailable:', ...indent(unavailable.map((u) => `${u.measurement}: ${u.reason}`)));
  }
  const notes = [...result.notes, ...(comparison?.notes ?? [])];
  if (notes.length) lines.push('', 'Notes:', ...indent(notes));

  if (result.runs > 0) {
    const throttle = result.cpuThrottling > 1 ? `CPU slowed ${result.cpuThrottling}x` : 'CPU not slowed';
    lines.push(
      '',
      `Measured in ${result.mode} mode, ${throttle}, the median of ${result.runs} run${result.runs === 1 ? '' : 's'}.`,
    );
  }
  return lines.join('\n');
}

/** The outcome's numbers on their own, for a program: small enough to keep in an agent's context. */
export interface OutcomeSummary {
  label: string;
  verdict: Verdict;
  budget: 'met' | 'missed' | null;
  mode: JanklessMode;
  runs: number;
  cpuThrottling: number;
  /** Each number that was measured, by its result field. */
  metrics: Record<string, number>;
  /** Each number compared with the baseline. Empty when nothing was compared. */
  checks: {
    metric: string;
    name: string;
    current: number | null;
    baseline: number | null;
    change: number | null;
    changePercent: number | null;
    status: 'worse' | 'better' | 'no-clear-change' | 'unavailable' | 'not-compared';
    noisy: boolean;
  }[];
  /** The slowest interaction, such as `click on button#checkout`. */
  slowest: { event: string; target: string; ms: number } | null;
  resultFile: string;
}

export function summarize(o: Omit<AdhocOutcome, 'text'>): OutcomeSummary {
  const { result } = o;
  const metrics: Record<string, number> = {};
  const add = (name: string, value: number | null | undefined) => {
    if (typeof value === 'number') metrics[name] = value;
  };
  add('input.p95ToPaintMs', result.input?.p95ToPaintMs);
  add('longFrames.count', result.longFrames?.count);
  add('longFrames.worstMs', result.longFrames?.worstMs);
  add('longFrames.totalBlockingMs', result.longFrames?.totalBlockingMs);
  add('frames.onTimePercent', result.frames?.onTimePercent);
  add('frames.dropped', result.frames?.dropped);
  add('list.blankFramePercent', result.list?.blankFramePercent);
  const top = result.input?.byTarget[0];
  return {
    label: o.label,
    verdict: o.verdict,
    budget: o.budget,
    mode: result.mode,
    runs: result.runs,
    cpuThrottling: result.cpuThrottling,
    metrics,
    checks: (o.comparison?.checks ?? []).map((c) => ({
      metric: c.metric,
      name: c.name,
      current: c.current,
      baseline: c.baseline,
      change: c.change,
      changePercent: c.changePercent,
      status: c.status === 'pass' ? (improved(c) ? 'better' : 'no-clear-change') : c.status,
      noisy: !!c.noisy,
    })),
    slowest: top ? { event: top.event, target: top.target, ms: top.ms } : null,
    resultFile: o.resultFile,
  };
}

/** The labels that have been measured ad hoc, for a message that has to say which ones exist. */
export function listLabels(dir = defaultAdhocDir()): string[] {
  const labels: string[] = [];
  for (const file of filesEndingIn(resultsDir(resolve(dir)), '.recipe.json')) {
    try {
      const recipe = JSON.parse(readFileSync(file, 'utf8')) as { kind?: string; request?: AdhocRequest };
      if (recipe.kind === RECIPE_KIND && recipe.request?.label) labels.push(recipe.request.label);
    } catch {
      // unreadable recipe: skipped
    }
  }
  return labels.sort();
}

/**
 * A stored result's comparison as an outcome, for a result from a Playwright test: what its
 * last run found. Ad-hoc results are measured again instead (`remeasure()`).
 */
export function storedOutcome(found: FoundResult, resultFile = ''): AdhocOutcome {
  const { result } = found;
  const comparison = result.comparison ?? null;
  const outcome = {
    label: result.label,
    verdict: verdictOf(comparison, 'compare'),
    budget: comparison?.budget ? (missedBudget(comparison).length ? 'missed' : 'met') : null,
    result,
    comparison,
    resultFile,
  } as const;
  return { ...outcome, text: formatOutcome(outcome) };
}

/**
 * Where the time went in a result: the functions that used the most CPU (full mode), and the
 * scripts that ran in its long frames (any mode).
 */
export function formatHotFunctions(result: JanklessResult, limit = 5): string {
  const lines: string[] = [];
  const hot = result.profile?.hotFunctions.slice(0, limit) ?? [];
  if (hot.length) {
    lines.push(
      `Where the CPU time went in "${result.label}" (${formatValue(result.profile!.sampledMs, 'ms')} sampled per run):`,
    );
    hot.forEach((f, i) => lines.push(`  ${i + 1}. ${describeHotFunction(f)}`));
  } else if (result.mode === 'quick') {
    lines.push(
      `"${result.label}" was measured in quick mode, which has no CPU profile. Measure it in full mode to get one.`,
    );
  } else {
    const why = result.unavailable.find((u) => u.measurement === 'profile')?.reason;
    lines.push(`"${result.label}" has no CPU profile${why ? `: ${why}` : '.'}`);
  }
  const scripts = result.longFrames?.topScripts.slice(0, limit) ?? [];
  if (scripts.length) {
    lines.push('', 'Scripts in the long frames:');
    scripts.forEach((s, i) => lines.push(`  ${i + 1}. ${describeScript(s)}`));
  } else if (result.longFrames) {
    lines.push('', 'No frame took over 50ms.');
  }
  return lines.join('\n');
}
