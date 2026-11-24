// npx playwright-butter measure: its arguments and exit code. The measuring is in tests/integration.
import { test, expect } from '@playwright/test';
import { main } from '../../packages/playwright-butter/src/cli.js';
import { exitCodeOf, parseMeasureArgs } from '../../packages/playwright-butter/src/measure-command.js';

const URL = 'http://localhost:5173/products';

async function cli(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (...a: unknown[]) => void out.push(a.join(' '));
  console.error = (...a: unknown[]) => void err.push(a.join(' '));
  try {
    const code = await main(argv);
    return { code, out: out.join('\n'), err: err.join('\n') };
  } finally {
    console.log = log;
    console.error = error;
  }
}

test('step flags keep the order they were typed in', () => {
  const parsed = parseMeasureArgs([
    URL,
    '--click',
    '#search',
    '--type',
    'abc',
    '--wait',
    '200',
    '--press',
    'Enter',
    '--hover',
    '.result',
    '--click',
    '.result a',
  ]);
  expect(parsed?.request).toEqual({
    url: URL,
    steps: [
      { action: 'click', selector: '#search' },
      { action: 'type', text: 'abc' },
      { action: 'wait', ms: 200 },
      { action: 'press', key: 'Enter' },
      { action: 'hover', selector: '.result' },
      { action: 'click', selector: '.result a' },
    ],
  });
  expect(parsed).toMatchObject({ json: false, enforce: 'warn' });
});

test('--steps and --setup take JSON', () => {
  const steps = [{ action: 'type', selector: '#q', text: 'abc' }];
  const setup = [{ action: 'click', selector: '#open' }];
  const parsed = parseMeasureArgs([URL, '--steps', JSON.stringify(steps), '--setup', JSON.stringify(setup)]);
  expect(parsed?.request).toEqual({ url: URL, steps, setup });
});

test('a scroll, with its options', () => {
  expect(parseMeasureArgs([URL, '--scroll', '#feed'])?.request).toEqual({
    url: URL,
    scroll: { selector: '#feed' },
  });
  expect(
    parseMeasureArgs([
      URL,
      '--scroll',
      'html',
      '--distance',
      '3000',
      '--speed',
      'fast',
      '--input',
      'keys',
      '--direction',
      'horizontal',
    ])?.request.scroll,
  ).toEqual({ selector: 'html', distance: 3000, speed: 'fast', input: 'keys', direction: 'horizontal' });
  expect(
    parseMeasureArgs([URL, '--scroll', 'html', '--distance', 'end', '--speed', '4500'])?.request.scroll,
  ).toEqual({
    selector: 'html',
    distance: 'end',
    speed: 4500,
  });
});

test('the other options', () => {
  const parsed = parseMeasureArgs([
    URL,
    '--click',
    '#open',
    '--label',
    'open filters',
    '--baseline',
    'record',
    '--mode',
    'full',
    '--runs',
    '3',
    '--cpu',
    '6',
    '--max-increase',
    '0.25',
    '--budget',
    '{"maxLongFrames":0}',
    '--dir',
    '.butter',
    '--headed',
    '--json',
    '--enforce',
    'fail',
  ]);
  expect(parsed).toEqual({
    request: {
      url: URL,
      steps: [{ action: 'click', selector: '#open' }],
      label: 'open filters',
      baseline: 'record',
      mode: 'full',
      runs: 3,
      cpuThrottling: 6,
      maxIncrease: 0.25,
      budget: { maxLongFrames: 0 },
      dir: '.butter',
      headed: true,
    },
    json: true,
    enforce: 'fail',
  });
});

for (const [name, args, message] of [
  ['no URL', ['--click', '#a'], 'Give one URL to measure.'],
  ['two URLs', [URL, URL, '--click', '#a'], 'Give one URL to measure.'],
  ['nothing to measure', [URL], 'Give the steps to measure'],
  [
    'step flags and --steps',
    [URL, '--click', '#a', '--steps', '[]'],
    'Give step flags or --steps, not both.',
  ],
  ['steps and a scroll', [URL, '--click', '#a', '--scroll', 'html'], 'Give steps or --scroll, not both.'],
  [
    'a scroll option without a scroll',
    [URL, '--click', '#a', '--speed', 'fast'],
    '--speed goes with --scroll.',
  ],
  ['steps that are not JSON', [URL, '--steps', 'click'], '--steps must be JSON.'],
  [
    'a wait that is not a number',
    [URL, '--click', '#a', '--wait', 'soon'],
    "--wait must be a number, got 'soon'.",
  ],
  ['runs that are not a number', [URL, '--click', '#a', '--runs', 'many'], '--runs must be a number'],
  ['an unknown enforce', [URL, '--click', '#a', '--enforce', 'maybe'], '--enforce must be warn or fail'],
  ['an unknown option', [URL, '--click', '#a', '--fast'], "Unknown option '--fast'"],
] as const) {
  test(`${name} is refused`, () => {
    expect(() => parseMeasureArgs([...args])).toThrow(message);
  });
}

test('--help prints the usage and succeeds', async () => {
  expect(parseMeasureArgs(['--help'])).toBeNull();
  const r = await cli('measure', '--help');
  expect(r.code).toBe(0);
  expect(r.out).toContain('Usage: npx playwright-butter measure <url> [steps] [options]');
  expect((await cli('--help')).out).toContain('measure     Measure an interaction or a scroll');
});

test('a mistake fails with the message and where to find the options, and opens no browser', async () => {
  const none = await cli('measure', URL);
  expect(none.code).toBe(1);
  expect(none.err).toContain('Give the steps to measure');
  expect(none.err).toContain('Run npx playwright-butter measure --help for the options.');

  const badUrl = await cli('measure', 'products', '--click', '#a');
  expect(badUrl.code).toBe(1);
  expect(badUrl.err).toContain("'products' isn't a URL");
});

test('the exit code: a missed budget always fails, a worse check only with --enforce fail', () => {
  expect(exitCodeOf({ verdict: 'worse', budget: null }, 'warn')).toBe(0);
  expect(exitCodeOf({ verdict: 'worse', budget: null }, 'fail')).toBe(1);
  expect(exitCodeOf({ verdict: 'better', budget: 'missed' }, 'warn')).toBe(1);
  expect(exitCodeOf({ verdict: 'no-clear-change', budget: 'met' }, 'fail')).toBe(0);
  expect(exitCodeOf({ verdict: 'baseline-recorded', budget: null }, 'fail')).toBe(0);
});
