// The MCP server, through a real client, for everything that needs no browser.
// Measuring through it is in tests/integration/adhoc.spec.ts.
import { test, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../packages/playwright-butter-mcp/src/server.js';
import { compareMetrics, metricsOf } from '../../packages/butter-churn/src/baseline/compare.js';
import { resultPath } from '../../packages/butter-churn/src/output.js';
import { makeResult } from './result-factory.js';

let dir: string;
let client: Client;

test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'butter-mcp-'));
  const server = createServer({
    dir: join(dir, 'adhoc'),
    results: join(dir, 'test-results'),
    version: '1.2.3',
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
});
test.afterEach(async () => {
  await client.close();
  rmSync(dir, { recursive: true, force: true });
});

type Called = { isError?: boolean; content: { type: string; text: string }[]; structuredContent?: unknown };
const call = (name: string, args: Record<string, unknown>) =>
  client.callTool({ name, arguments: args }) as Promise<Called>;

test('it names itself and says how to check a change', () => {
  expect(client.getServerVersion()).toMatchObject({ name: 'playwright-butter', version: '1.2.3' });
  const instructions = client.getInstructions()!;
  expect(instructions).toContain('call measure_interaction');
  expect(instructions).toContain('Call compare_baseline with that label');
});

test('three tools, each with a description and a plain object for its arguments', async () => {
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toEqual(['measure_interaction', 'compare_baseline', 'get_hot_functions']);
  for (const tool of tools) {
    expect(tool.description!.length).toBeGreaterThan(80);
    expect(tool.inputSchema.type).toBe('object');
  }
  const measure = tools[0]!;
  expect(Object.keys(measure.inputSchema.properties!)).toEqual([
    'url',
    'steps',
    'scroll',
    'setup',
    'label',
    'mode',
    'runs',
    'cpuThrottling',
    'baseline',
    'budget',
  ]);
  expect(measure.inputSchema.required).toEqual(['url']);
  // Steps are one flat object, not a union: some clients only pass plain objects through.
  const step = (measure.inputSchema.properties!.steps as { items: { type: string; properties: object } })
    .items;
  expect(step.type).toBe('object');
  expect(Object.keys(step.properties)).toEqual(['action', 'selector', 'text', 'key', 'ms']);
  expect(measure.outputSchema?.properties).toHaveProperty('verdict');
  expect(tools[2]!.annotations).toMatchObject({ readOnlyHint: true });
});

test('a mistake in the request comes back as an error, before a browser opens', async () => {
  const url = 'http://localhost:5173/';
  const noSelector = await call('measure_interaction', { url, steps: [{ action: 'click' }] });
  expect(noSelector.isError).toBe(true);
  expect(noSelector.content[0]!.text).toContain('steps[0]: a click step needs a selector');

  const nothing = await call('measure_interaction', { url });
  expect(nothing).toMatchObject({ isError: true });
  expect(nothing.content[0]!.text).toContain('give either steps or a scroll');
});

test('a label nobody measured: the error says what has been measured', async () => {
  const first = await call('compare_baseline', { label: 'open filters' });
  expect(first.isError).toBe(true);
  expect(first.content[0]!.text).toContain('Nothing has been measured as "open filters"');
  expect(first.content[0]!.text).toContain('call measure_interaction first');

  const results = join(dir, 'adhoc', 'results');
  mkdirSync(results, { recursive: true });
  const path = resultPath(results, 'sort the board');
  writeFileSync(path, JSON.stringify(makeResult({ label: 'sort the board' })));
  writeFileSync(
    path.replace(/\.json$/, '.recipe.json'),
    JSON.stringify({
      schemaVersion: 1,
      kind: 'playwright-butter-recipe',
      request: {
        url: 'http://localhost:5173/',
        steps: [{ action: 'click', selector: '#sort' }],
        label: 'sort the board',
      },
    }),
  );
  const second = await call('get_hot_functions', { label: 'open filters' });
  expect(second.isError).toBe(true);
  expect(second.content[0]!.text).toContain('Measured so far: "sort the board".');
});

function writeTestResult() {
  const before = makeResult();
  const now = makeResult({
    input: { p95ToPaintMs: 240, worstMs: 240 },
    test: { title: 'Filters › open smoothly', file: 'tests/filters.spec.ts', project: 'chromium' },
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
        { fn: 'layout', url: '', line: 0, column: 0, selfMs: 30, totalMs: 30, callers: ['sortRows'] },
      ],
    },
  });
  now.comparison = {
    status: 'warn',
    checks: compareMetrics(now, metricsOf(before), 0.15),
    baseline: null,
    notes: [],
  };
  const folder = join(dir, 'test-results', 'butter', 'filters-open-smoothly-1234abcd');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'open-filters.json'), JSON.stringify(now));
}

test("compare_baseline on a test's label returns what the last test run found", async () => {
  writeTestResult();
  const r = await call('compare_baseline', { label: 'open filters' });
  expect(r.isError).toBeFalsy();
  const text = r.content[0]!.text;
  expect(text).toMatch(/^"open filters" is less smooth than its baseline:/);
  expect(text).toContain(
    'This is what the last run of the test "Filters › open smoothly" (tests/filters.spec.ts) found. Run that test again to measure a change.',
  );
  expect(r.structuredContent).toMatchObject({
    label: 'open filters',
    verdict: 'worse',
    metrics: { 'input.p95ToPaintMs': 240 },
    checks: [{ metric: 'input.p95ToPaintMs', status: 'worse' }, { metric: 'longFrames.count' }],
  });
});

test('get_hot_functions reads the last result, as many as asked for', async () => {
  writeTestResult();
  const r = await call('get_hot_functions', { label: 'open filters', limit: 1 });
  expect(r.isError).toBeFalsy();
  expect(r.content[0]!.text).toContain(
    '1. sortRows in app.js:22: 90ms self (120ms with calls), from onFilterClick',
  );
  expect(r.content[0]!.text).not.toContain('layout');
  expect(r.structuredContent).toMatchObject({
    label: 'open filters',
    mode: 'full',
    sampledMs: 150,
    hotFunctions: [{ fn: 'sortRows', line: 22 }],
    scripts: [{ fn: 'onFilterClick' }],
  });
  expect((r.structuredContent as { hotFunctions: unknown[] }).hotFunctions).toHaveLength(1);
});
