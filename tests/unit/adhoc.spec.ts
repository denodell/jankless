// Ad-hoc measurements, apart from the measuring: requests, labels, where files go, and the wording.
import { test, expect } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_WAIT_MS,
  defaultAdhocDir,
  defaultLabel,
  findResult,
  formatHotFunctions,
  formatOutcome,
  listLabels,
  readLastResult,
  readRecipe,
  storedOutcome,
  summarize,
  validateRequest,
  type AdhocOutcome,
  type Verdict,
} from '../../packages/jankless/src/adhoc.js';
import { compareMetrics, improved, metricsOf } from '../../packages/jankless/src/baseline/compare.js';
import { resultPath } from '../../packages/jankless/src/output.js';
import type { JanklessResult, Comparison } from '../../packages/jankless/src/types.js';
import { makeResult } from './result-factory.js';

let dir: string;
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jankless-adhoc-'));
});
test.afterEach(() => rmSync(dir, { recursive: true, force: true }));

const URL = 'http://localhost:5173/products';
const click = { action: 'click', selector: '#open' } as const;

// ---- requests ----

test('a valid request comes back with its URL normalized', () => {
  const r = validateRequest({ url: 'http://localhost:5173', steps: [click] });
  expect(r.url).toBe('http://localhost:5173/');
  expect(r.steps).toEqual([click]);
});

test('unknown fields on a step are dropped', () => {
  const r = validateRequest({ url: URL, steps: [{ ...click, extra: 1 }] });
  expect(r.steps).toEqual([click]);
});

for (const [name, request, message] of [
  ['no URL', { steps: [click] }, 'a URL is needed'],
  ['a relative URL', { url: '/products', steps: [click] }, "isn't a URL"],
  ['another protocol', { url: 'chrome://settings', steps: [click] }, 'only http, https and file URLs'],
  ['neither steps nor a scroll', { url: URL }, 'give either steps or a scroll'],
  ['both steps and a scroll', { url: URL, steps: [click], scroll: {} }, 'give either steps or a scroll'],
  ['no steps', { url: URL, steps: [] }, 'steps is empty'],
  ['only waiting', { url: URL, steps: [{ action: 'wait', ms: 10 }] }, 'steps only waits'],
  ['an unknown action', { url: URL, steps: [{ action: 'drag' }] }, "steps[0]: unknown action 'drag'"],
  ['a click with no selector', { url: URL, steps: [{ action: 'click' }] }, 'a click step needs a selector'],
  ['typing nothing', { url: URL, steps: [{ action: 'type', text: '' }] }, 'a type step needs text'],
  [
    'a press with no key',
    { url: URL, steps: [click, { action: 'press' }] },
    'steps[1]: a press step needs a key',
  ],
  [
    'a wait that is too long',
    { url: URL, steps: [click, { action: 'wait', ms: MAX_WAIT_MS + 1 }] },
    `from 0 to ${MAX_WAIT_MS}`,
  ],
  ['a bad setup step', { url: URL, steps: [click], setup: [{ action: 'hover' }] }, 'setup[0]: a hover step'],
  [
    'a bad scroll input',
    { url: URL, scroll: { input: 'drag' } },
    "scroll's input must be wheel, touch or keys",
  ],
  [
    'a mode that does not exist',
    { url: URL, steps: [click], mode: 'fast' },
    "mode must be quick or full, got 'fast'",
  ],
  ['a bad scroll distance', { url: URL, scroll: { distance: -5 } }, 'distance must be'],
  [
    'a bad baseline use',
    { url: URL, steps: [click], baseline: 'maybe' },
    'baseline must be compare, record, off',
  ],
  ['no runs', { url: URL, steps: [click], runs: 0 }, 'runs must be a positive integer'],
  ['an unknown budget', { url: URL, steps: [click], budget: { maxJank: 1 } }, 'maxJank'],
] as const) {
  test(`a request with ${name} is refused before a browser opens`, () => {
    expect(() => validateRequest(request)).toThrow(message);
  });
}

// ---- labels ----

test('the default label is built from the steps and the path', () => {
  expect(
    defaultLabel({
      url: 'http://localhost:5173/checkout?step=2#pay',
      steps: [
        click,
        { action: 'type', text: 'abc' },
        { action: 'type', selector: '#q', text: 'x' },
        { action: 'press', key: 'Enter' },
        { action: 'hover', selector: '.menu' },
        { action: 'wait', ms: 200 },
      ],
    }),
  ).toBe(
    'click #open, type "abc", type "x" into #q, press Enter, hover .menu, wait 200ms on /checkout?step=2',
  );
});

test('the default label for a scroll names what differs from the defaults', () => {
  expect(defaultLabel({ url: URL, scroll: {} })).toBe('scroll html on /products');
  expect(defaultLabel({ url: URL, scroll: { selector: '#feed', speed: 'fast', distance: 3000 } })).toBe(
    'scroll #feed 6000px/s 3000px on /products',
  );
  expect(defaultLabel({ url: 'file:///tmp/demo/list.html', scroll: {} })).toBe('scroll html on list.html');
});

test('the port is left out, so a dev server on another port keeps its baseline', () => {
  const steps = [click];
  expect(defaultLabel({ url: 'http://localhost:5173/a', steps })).toBe(
    defaultLabel({ url: 'http://localhost:4000/a', steps }),
  );
});

// ---- where files go ----

test('files go in the nearest node_modules, which dev servers do not watch', () => {
  mkdirSync(join(dir, 'node_modules'));
  mkdirSync(join(dir, 'apps', 'web'), { recursive: true });
  const expected = join(dir, 'node_modules', '.cache', 'jankless', 'adhoc');
  expect(defaultAdhocDir(dir)).toBe(expected);
  expect(defaultAdhocDir(join(dir, 'apps', 'web'))).toBe(expected);
});

test('with no node_modules, files go in the temporary folder, one folder per project', () => {
  mkdirSync(join(dir, 'a', '.git'), { recursive: true });
  mkdirSync(join(dir, 'b', '.git'), { recursive: true });
  const a = defaultAdhocDir(join(dir, 'a'));
  expect(a.startsWith(join(tmpdir(), 'jankless-adhoc'))).toBe(true);
  expect(defaultAdhocDir(join(dir, 'a'))).toBe(a);
  expect(defaultAdhocDir(join(dir, 'b'))).not.toBe(a);
});

function store(result: JanklessResult, recipe?: object) {
  const path = resultPath(join(dir, 'results'), result.label);
  mkdirSync(join(dir, 'results'), { recursive: true });
  writeFileSync(path, JSON.stringify(result));
  if (recipe) {
    writeFileSync(
      path.replace(/\.json$/, '.recipe.json'),
      JSON.stringify({ schemaVersion: 1, kind: 'jankless-recipe', request: recipe }),
    );
  }
}

test('a label finds its last result and its recipe', () => {
  const recipe = { url: URL, steps: [click], label: 'Open filters' };
  store(makeResult({ label: 'Open filters' }), recipe);
  store(makeResult({ label: 'no recipe' }));
  expect(readLastResult('Open filters', dir)?.label).toBe('Open filters');
  expect(readRecipe('Open filters', dir)).toEqual(recipe);
  expect(readRecipe('no recipe', dir)).toBeNull();
  expect(readLastResult('never measured', dir)).toBeNull();
  expect(listLabels(dir)).toEqual(['Open filters']);
  expect(listLabels(join(dir, 'nowhere'))).toEqual([]);
});

test('a label falls back to the last Playwright run, by label or by test title', () => {
  const results = join(dir, 'test-results');
  const folder = join(results, 'jankless', 'filters-open-1234abcd');
  mkdirSync(folder, { recursive: true });
  const fromTest = makeResult({
    label: 'open filters',
    test: { title: 'Filters open smoothly', file: 'tests/filters.spec.ts', project: 'chromium' },
  });
  writeFileSync(join(folder, 'open-filters.json'), JSON.stringify(fromTest));

  expect(findResult('open filters', { dir, results })).toMatchObject({ source: 'test' });
  expect(findResult('filters open smoothly', { dir, results })?.result.label).toBe('open filters');
  expect(findResult('something else', { dir, results })).toBeNull();

  store(makeResult({ label: 'open filters', runs: 3 }));
  expect(findResult('open filters', { dir, results })).toMatchObject({
    source: 'adhoc',
    result: { runs: 3 },
  });
});

// ---- wording ----

function compared(now: JanklessResult, before: JanklessResult): Comparison {
  const checks = compareMetrics(now, metricsOf(before), now.settings.maxIncrease);
  return {
    status: checks.some((c) => c.status === 'worse') ? 'warn' : 'pass',
    checks,
    baseline: null,
    notes: [],
  };
}

function outcome(
  result: JanklessResult,
  comparison: Comparison | null,
  verdict: Verdict,
): Omit<AdhocOutcome, 'text'> {
  return { label: result.label, verdict, budget: null, result, comparison, resultFile: '/tmp/r.json' };
}

test('improved() is the mirror of worse', () => {
  const before = makeResult({
    mode: 'full',
    frames: { total: 100, onTime: 80, dropped: 20, onTimePercent: 80 },
  });
  const check = (now: JanklessResult, metric: string) =>
    compareMetrics(now, metricsOf(before), 0.15).find((c) => c.metric === metric)!;

  const faster = makeResult({ input: { p95ToPaintMs: 64 } });
  expect(improved(check(faster, 'input.p95ToPaintMs'))).toBe(true);
  const aLittleFaster = makeResult({ input: { p95ToPaintMs: 104 } });
  expect(improved(check(aLittleFaster, 'input.p95ToPaintMs'))).toBe(false);
  const slower = makeResult({ input: { p95ToPaintMs: 200 } });
  expect(check(slower, 'input.p95ToPaintMs').status).toBe('worse');
  expect(improved(check(slower, 'input.p95ToPaintMs'))).toBe(false);

  // On-time frames improve by going up.
  const onTime = (percent: number) =>
    makeResult({
      mode: 'full',
      frames: { total: 100, onTime: percent, dropped: 100 - percent, onTimePercent: percent },
    });
  expect(improved(check(onTime(95), 'frames.onTimePercent'))).toBe(true);
  expect(improved(check(onTime(81), 'frames.onTimePercent'))).toBe(false);
  expect(check(onTime(60), 'frames.onTimePercent').status).toBe('worse');
});

test('jankier: what got worse comes first, then the code behind it', () => {
  const before = makeResult();
  const now = makeResult({ input: { p95ToPaintMs: 240, worstMs: 240 } });
  expect(formatOutcome(outcome(now, compared(now, before), 'worse'))).toBe(
    [
      '"open filters" is jankier than its baseline:',
      '  input-to-paint (p95) 240ms (+128ms, +114.3%), slowest: click on button#filters',
      'No clear change:',
      '  long frames 1 (±0, ±0%)',
      '',
      'Scripts in the long frames:',
      '  1. onFilterClick in app.js (BUTTON#filters.onclick): ran 108ms, 58ms of it blocking, during click on button#filters',
      '',
      'Measured in quick mode, CPU slowed 4x, the median of 5 runs.',
    ].join('\n'),
  );
});

test('smoother, no clear change, and a first measurement each say so in the first line', () => {
  const before = makeResult();
  const faster = makeResult({ input: { p95ToPaintMs: 48, worstMs: 48 } });
  expect(formatOutcome(outcome(faster, compared(faster, before), 'better'))).toMatch(
    /^"open filters" is smoother than its baseline:\n {2}input-to-paint \(p95\) 48ms \(−64ms, −57\.1%\)/,
  );

  const same = makeResult({ input: { p95ToPaintMs: 120, worstMs: 120 } });
  const text = formatOutcome(outcome(same, compared(same, before), 'no-clear-change'));
  expect(text).toMatch(
    /^"open filters": no clear change from its baseline\. Every number moved less than 15%/,
  );
  expect(text).toContain('input-to-paint (p95) 120ms (+8ms, +7.1%)');

  const recorded: Comparison = { status: 'baseline-created', checks: [], baseline: null, notes: [] };
  expect(formatOutcome(outcome(before, recorded, 'baseline-recorded'))).toMatch(
    /^"open filters": baseline recorded\. Measure it again after a change to compare\.\n {2}input-to-paint \(p95\) 112ms, slowest: click on button#filters\n {2}long frames 1 \(the longest 108ms\)/,
  );
  expect(formatOutcome(outcome(before, null, 'measured'))).toMatch(
    /^"open filters": measured, and not compared with a baseline\./,
  );
});

test('a noisy check, a missed budget and anything unavailable are all named', () => {
  const before = makeResult();
  const now = makeResult({
    spread: { 'input.p95ToPaintMs': { min: 80, median: 112, max: 140 } },
    unavailable: [{ measurement: 'frames', reason: 'no trace' }],
    notes: ['The page did not go quiet.'],
  });
  const comparison = compared(now, before);
  comparison.budget = [
    {
      metric: 'longFrames.count',
      name: 'long frames',
      unit: 'count',
      kind: 'max',
      limit: 0,
      current: 1,
      status: 'over',
    },
  ];
  const text = formatOutcome({ ...outcome(now, comparison, 'no-clear-change'), budget: 'missed' });
  expect(text).toContain('Missed its budget:\n  long frames 1 (budget: at most 0)');
  expect(text).toContain('Noise: input-to-paint (p95) varied 53.6% across 5 runs, more than the 15% allowed');
  expect(text).toContain('Unavailable:\n  frames: no trace');
  expect(text).toContain('Notes:\n  The page did not go quiet.');
});

test('nothing measured: the reason is the whole answer', () => {
  const empty = makeResult({ runs: 0, input: null, longFrames: null });
  const comparison: Comparison = {
    status: 'not-compared',
    checks: [],
    baseline: null,
    notes: ['Nothing was measured: every run navigated to a new document.'],
  };
  expect(formatOutcome(outcome(empty, comparison, 'not-compared'))).toBe(
    [
      '"open filters": not compared with a baseline.',
      '',
      'Notes:',
      '  Nothing was measured: every run navigated to a new document.',
    ].join('\n'),
  );
});

test('the summary carries the numbers and each check, and little else', () => {
  const before = makeResult();
  const now = makeResult({ input: { p95ToPaintMs: 240, worstMs: 240 } });
  expect(summarize(outcome(now, compared(now, before), 'worse'))).toEqual({
    label: 'open filters',
    verdict: 'worse',
    budget: null,
    mode: 'quick',
    runs: 5,
    cpuThrottling: 4,
    metrics: {
      'input.p95ToPaintMs': 240,
      'longFrames.count': 1,
      'longFrames.worstMs': 108,
      'longFrames.totalBlockingMs': 58,
    },
    checks: [
      expect.objectContaining({ metric: 'input.p95ToPaintMs', current: 240, baseline: 112, status: 'worse' }),
      expect.objectContaining({ metric: 'longFrames.count', status: 'no-clear-change', noisy: false }),
    ],
    slowest: { event: 'click', target: 'button#filters', ms: 112 },
    resultFile: '/tmp/r.json',
  });
});

test("a test's stored comparison reads the same way as an ad-hoc one", () => {
  const before = makeResult();
  const now = makeResult({ input: { p95ToPaintMs: 240, worstMs: 240 } });
  now.comparison = compared(now, before);
  const stored = storedOutcome({ result: now, source: 'test' });
  expect(stored.verdict).toBe('worse');
  expect(stored.text).toMatch(/^"open filters" is jankier than its baseline:/);

  const untouched = storedOutcome({ result: makeResult(), source: 'test' });
  expect(untouched.verdict).toBe('measured');
});

test('a result or a recipe that cannot be read counts as never measured', () => {
  const path = resultPath(join(dir, 'results'), 'half written');
  mkdirSync(join(dir, 'results'), { recursive: true });
  writeFileSync(path, '{"schemaVersion": 1, "label": "half wr');
  writeFileSync(path.replace(/\.json$/, '.recipe.json'), '{"kind": "playwright-jankless-rec');
  expect(readLastResult('half written', dir)).toBeNull();
  expect(readRecipe('half written', dir)).toBeNull();
  expect(listLabels(dir)).toEqual([]);
});

test('an interaction too quick for Event Timing is described, not left out', () => {
  const quick = makeResult();
  quick.input = { ...quick.input!, p95ToPaintMs: null, worstMs: null, byTarget: [] };
  delete quick.comparison;
  expect(storedOutcome({ result: quick, source: 'test' }).text).toContain(
    'input-to-paint: every interaction painted in under 16ms',
  );
});

test('hot functions: full mode without a profile says why', () => {
  const noProfile = makeResult({
    mode: 'full',
    unavailable: [{ measurement: 'profile', reason: 'the trace had no CPU samples' }],
  });
  expect(formatHotFunctions(noProfile)).toContain(
    '"open filters" has no CPU profile: the trace had no CPU samples',
  );
  expect(formatHotFunctions(makeResult({ mode: 'full' }))).toContain('"open filters" has no CPU profile.');
});

test('hot functions: the profile in full mode, and how to get one in quick mode', () => {
  const quick = formatHotFunctions(makeResult());
  expect(quick).toMatch(/^"open filters" was measured in quick mode, which has no CPU profile\./);
  expect(quick).toContain('Scripts in the long frames:\n  1. onFilterClick in app.js');

  const full = makeResult({
    mode: 'full',
    profile: {
      sampledMs: 150,
      hotFunctions: [
        {
          fn: 'sortRows',
          url: 'http://localhost:4173/js/app.js',
          line: 22,
          column: 3,
          selfMs: 90,
          totalMs: 120,
          callers: ['onFilterClick'],
        },
        { fn: '(program)', url: '', line: 0, column: 0, selfMs: 20, totalMs: 20, callers: [] },
      ],
    },
  });
  expect(formatHotFunctions(full, 1)).toMatch(
    /^Where the CPU time went in "open filters" \(150ms sampled per run\):\n {2}1\. sortRows in app\.js:22: 90ms self \(120ms with calls\), from onFilterClick\n\nScripts/,
  );
  expect(formatHotFunctions(full, 1)).not.toContain('(program)');

  const smooth = makeResult({ longFrames: { count: 0, totalBlockingMs: 0, worstMs: null, topScripts: [] } });
  expect(formatHotFunctions(smooth)).toContain('No frame took over 50ms.');
});
