// Ad-hoc measurements end to end: a URL and steps, with no butter fixture and no spec for the
// page. Each one opens its own browser, the way `npx playwright-butter measure` and the MCP
// server do.
import { test, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  measureAdhoc,
  readRecipe,
  remeasure,
  type AdhocRequest,
} from '../../packages/playwright-butter/src/adhoc.js';
import { main } from '../../packages/playwright-butter/src/cli.js';
import { createServer } from '../../packages/playwright-butter-mcp/src/server.js';

test.setTimeout(120_000);

let dir: string;
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'butter-adhoc-'));
});
test.afterEach(() => rmSync(dir, { recursive: true, force: true }));

const heavyClick = (baseURL: string, ms: number): AdhocRequest => ({
  url: `${baseURL}/click.html?ms=${ms}`,
  steps: [{ action: 'click', selector: '#heavy' }],
  label: 'heavy click',
  runs: 2,
  dir,
});

test('a click: the first run records a baseline, and later runs say which way it moved', async ({
  baseURL,
}) => {
  const first = await measureAdhoc(heavyClick(baseURL!, 150));
  expect(first.verdict).toBe('baseline-recorded');
  expect(first.result.runs).toBe(2);
  expect(first.result.headlessMode).toBe('new-headless');
  expect(first.result.input!.byTarget[0]).toMatchObject({ target: 'button#heavy', event: 'click' });
  expect(first.result.longFrames!.topScripts[0]!.fn).toBe('onHeavyClick');
  expect(first.text).toMatch(/^"heavy click": baseline recorded\./);
  expect(existsSync(first.resultFile)).toBe(true);
  expect(JSON.parse(readFileSync(first.resultFile, 'utf8')).comparison.status).toBe('baseline-created');

  const same = await measureAdhoc(heavyClick(baseURL!, 150));
  expect(same.verdict).toBe('no-clear-change');
  expect(same.comparison!.checks.map((c) => c.metric)).toEqual(['input.p95ToPaintMs', 'longFrames.count']);

  const slower = await measureAdhoc(heavyClick(baseURL!, 400));
  expect(slower.verdict).toBe('worse');
  expect(slower.text).toMatch(/^"heavy click" is less smooth than its baseline:\n {2}input-to-paint \(p95\)/);
  expect(slower.text).toContain('onHeavyClick in click.js');

  const faster = await measureAdhoc(heavyClick(baseURL!, 20));
  expect(faster.verdict).toBe('better');

  // 'record' makes the faster result the baseline, so the old speed is now worse than it.
  expect((await measureAdhoc({ ...heavyClick(baseURL!, 20), baseline: 'record' })).verdict).toBe(
    'baseline-recorded',
  );
  expect((await measureAdhoc(heavyClick(baseURL!, 150))).verdict).toBe('worse');
});

test("baseline: 'off' only measures, and a budget is checked without one", async ({ baseURL }) => {
  const r = await measureAdhoc({
    ...heavyClick(baseURL!, 150),
    baseline: 'off',
    budget: { maxLongFrames: 0 },
  });
  expect(r.verdict).toBe('measured');
  expect(r.budget).toBe('missed');
  expect(r.text).toContain('Missed its budget:\n  long frames 1 (budget: at most 0)');
  expect(existsSync(join(dir, 'baselines'))).toBe(false);

  const met = await measureAdhoc({
    ...heavyClick(baseURL!, 150),
    baseline: 'off',
    budget: { maxLongFrames: 3 },
  });
  expect(met.budget).toBe('met');
  expect(met.text).toContain('Within its budget.');
});

test('typing is one interaction per key, and setup steps run before every run', async ({ baseURL }) => {
  const r = await measureAdhoc({
    url: `${baseURL}/search.html?ms=60`,
    setup: [{ action: 'click', selector: '#search' }],
    steps: [{ action: 'type', text: 'abc' }],
    runs: 2,
    dir,
  });
  expect(r.label).toBe('type "abc" on /search.html?ms=60');
  // Typed into the focused element: without the setup's click in every run, no key would land.
  expect(r.result.runs).toBe(2);
  expect(r.result.input!.interactions).toBe(3);
  expect(r.result.input!.byTarget[0]).toMatchObject({ target: 'input#search', event: 'keydown' });

  const bySelector = await measureAdhoc({
    url: `${baseURL}/search.html?ms=60`,
    steps: [{ action: 'type', selector: '#search', text: 'ab' }],
    runs: 2,
    dir,
  });
  expect(bySelector.result.input!.interactions).toBe(2);
});

test('a scroll, in full mode: frames and blank rows', async ({ baseURL }) => {
  const r = await measureAdhoc({
    url: `${baseURL}/list.html?cost=0&overscan=2`,
    scroll: { selector: '#list', distance: 6000, speed: 'fast' },
    mode: 'full',
    cpuThrottling: 1,
    runs: 2,
    viewport: { width: 600, height: 600 },
    dir,
  });
  expect(r.verdict).toBe('baseline-recorded');
  expect(r.label).toBe('scroll #list 6000px/s 6000px on /list.html?cost=0&overscan=2');
  expect(r.result.scroll).toMatchObject({ input: 'wheel', requestedPx: 6000 });
  expect(r.result.scroll!.scrolledPx).toBeGreaterThan(5000);
  expect(r.result.frames!.total).toBeGreaterThan(20);
  expect(r.result.list!.virtualized).toBe(true);
  expect(r.text).toMatch(/frames on time [\d.]+% \(\d+ of \d+ dropped\)/);
  expect(r.text).toMatch(/blank list frames [\d.]+%/);
  expect(r.text).toContain('Measured in full mode, CPU not slowed, the median of 2 runs.');
});

test('remeasure() runs a label again from its saved request', async ({ baseURL }) => {
  await measureAdhoc({ ...heavyClick(baseURL!, 150), baseline: 'off' });
  expect(readRecipe('heavy click', dir)).toMatchObject({
    url: `${baseURL}/click.html?ms=150`,
    steps: [{ action: 'click', selector: '#heavy' }],
    runs: 2,
  });
  expect(readRecipe('heavy click', dir)).not.toHaveProperty('dir');

  expect((await remeasure('heavy click', { dir, baseline: 'record' })).verdict).toBe('baseline-recorded');
  const again = await remeasure('heavy click', { dir });
  expect(again.verdict).toBe('no-clear-change');
  expect(again.result.runs).toBe(2);
  await expect(remeasure('never measured', { dir })).rejects.toThrow(
    '"never measured" hasn\'t been measured yet',
  );
});

test('a step whose element is missing fails with the selector, and steps that navigate say so', async ({
  baseURL,
}) => {
  await expect(
    measureAdhoc({
      url: `${baseURL}/click.html`,
      steps: [{ action: 'click', selector: '#nope' }],
      runs: 1,
      dir,
    }),
  ).rejects.toThrow(/locator\('#nope'\)/);

  const left = await measureAdhoc({
    url: `${baseURL}/click.html`,
    steps: [{ action: 'click', selector: '#leave' }],
    runs: 1,
    dir,
  });
  expect(left.verdict).toBe('not-compared');
  expect(left.text).toContain('Nothing was measured: every run navigated to a new document');
});

test('npx playwright-butter measure: text, JSON, and the exit code', async ({ baseURL }) => {
  const run = async (...argv: string[]) => {
    const out: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => void out.push(a.join(' '));
    try {
      return { code: await main(['measure', ...argv, '--runs', '2', '--dir', dir]), out: out.join('\n') };
    } finally {
      console.log = log;
    }
  };
  const click = ['--click', '#heavy', '--label', 'heavy click'];

  const first = await run(`${baseURL}/click.html?ms=100`, ...click);
  expect(first.code).toBe(0);
  expect(first.out).toMatch(/^"heavy click": baseline recorded\./);
  expect(first.out).toMatch(/\nResult: .*heavy-click-[0-9a-f]{6}\.json$/);

  const slower = await run(`${baseURL}/click.html?ms=400`, ...click, '--enforce', 'fail', '--json');
  expect(slower.code).toBe(1);
  const parsed = JSON.parse(slower.out);
  expect(parsed).toMatchObject({ label: 'heavy click', verdict: 'worse', budget: null });
  expect(parsed.result.comparison.status).toBe('warn');
  expect(parsed.result.schemaVersion).toBe(1);

  expect((await run(`${baseURL}/click.html?ms=400`, ...click)).code).toBe(0); // warn is the default
});

test('the MCP server: measure, change, compare, then ask where the time went', async ({ baseURL }) => {
  const server = createServer({ dir });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  type Called = {
    isError?: boolean;
    content: { text: string }[];
    structuredContent?: Record<string, unknown>;
  };
  const call = (name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: args }, undefined, { timeout: 60_000 }) as Promise<Called>;
  try {
    const measured = await call('measure_interaction', {
      url: `${baseURL}/click.html?ms=150`,
      steps: [{ action: 'click', selector: '#heavy' }],
      mode: 'full',
      runs: 2,
    });
    expect(measured.isError).toBeFalsy();
    expect(measured.structuredContent).toMatchObject({
      label: 'click #heavy on /click.html?ms=150',
      verdict: 'baseline-recorded',
      mode: 'full',
      runs: 2,
      slowest: { event: 'click', target: 'button#heavy' },
    });
    const label = measured.structuredContent!.label as string;

    const compared = await call('compare_baseline', { label });
    expect(compared.structuredContent).toMatchObject({ label, verdict: 'no-clear-change' });
    expect(compared.content[0]!.text).toMatch(/no clear change from its baseline/);

    const hot = await call('get_hot_functions', { label, limit: 3 });
    expect(hot.content[0]!.text).toMatch(
      /^Where the CPU time went in "click #heavy on \/click\.html\?ms=150"/,
    );
    expect(hot.content[0]!.text).toContain('busyWait in work.js');
    expect((hot.structuredContent!.hotFunctions as unknown[]).length).toBeGreaterThan(0);

    // Two calls at once are measured one after the other, not at the same time.
    const [a, b] = await Promise.all([
      call('compare_baseline', { label }),
      call('compare_baseline', { label }),
    ]);
    expect(a.isError).toBeFalsy();
    expect(b.isError).toBeFalsy();

    const missing = await call('measure_interaction', {
      url: `${baseURL}/click.html`,
      steps: [{ action: 'click', selector: '#nope' }],
      runs: 1,
    });
    expect(missing.isError).toBe(true);
    expect(missing.content[0]!.text).toContain("waiting for locator('#nope')");
    // eslint-disable-next-line no-control-regex
    expect(missing.content[0]!.text).not.toMatch(/\u001b\[/);
  } finally {
    await client.close();
  }
});
