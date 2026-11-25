// Finding a browser adapter, and the command line with and without one.
import { test, expect } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NO_ADAPTER, loadAdapter, type Adapter } from '../../packages/jankless/src/adapter.js';
import { help, main } from '../../packages/jankless/src/cli/cli.js';

let dir: string;
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jankless-adapter-'));
});
test.afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A project folder with a package named as the Playwright adapter is, exporting `adapter`. */
function installAdapter(project: string, files: Record<string, string>) {
  const pkg = join(project, 'node_modules', 'playwright-jankless');
  mkdirSync(join(pkg, 'dist'), { recursive: true });
  writeFileSync(
    join(pkg, 'package.json'),
    JSON.stringify({
      name: 'playwright-jankless',
      exports: { './adapter': { import: './dist/adapter.js', require: './dist/adapter.cjs' } },
    }),
  );
  for (const [name, text] of Object.entries(files)) writeFileSync(join(pkg, 'dist', name), text);
}

test('no adapter installed: the error says what to install', async () => {
  await expect(loadAdapter(dir, null)).rejects.toThrow(NO_ADAPTER);
  expect(NO_ADAPTER).toContain('npm install --save-dev playwright-jankless');
});

test("the project's adapter is found, and its ES module build is the one loaded", async () => {
  installAdapter(dir, {
    'adapter.cjs': "exports.adapter = { name: 'from the CommonJS build' };",
    'adapter.js': "export const adapter = { name: 'from the ES module build' };",
  });
  expect((await loadAdapter(dir, null)).name).toBe('from the ES module build');
});

test('an adapter with only a CommonJS build is loaded from it', async () => {
  installAdapter(dir, { 'adapter.cjs': "exports.adapter = { name: 'CommonJS only' };" });
  expect((await loadAdapter(dir, null)).name).toBe('CommonJS only');
});

test('an adapter beside the command is found when the project has none', async () => {
  const beside = join(dir, 'global');
  installAdapter(beside, { 'adapter.cjs': "exports.adapter = { name: 'beside the command' };" });
  const script = join(beside, 'node_modules', 'some-command.js');
  writeFileSync(script, '');
  const project = join(dir, 'project');
  mkdirSync(project);
  expect((await loadAdapter(project, script)).name).toBe('beside the command');
});

test('a package that exports no adapter is passed over', async () => {
  installAdapter(dir, { 'adapter.cjs': 'exports.somethingElse = 1;' });
  await expect(loadAdapter(dir, null)).rejects.toThrow(NO_ADAPTER);
});

async function run(argv: string[], adapter?: Adapter) {
  const out: string[] = [];
  const err: string[] = [];
  const { log, error } = console;
  console.log = (...a: unknown[]) => void out.push(a.join(' '));
  console.error = (...a: unknown[]) => void err.push(a.join(' '));
  try {
    return { code: await main(argv, { adapter }), out: out.join('\n'), err: err.join('\n') };
  } finally {
    console.log = log;
    console.error = error;
  }
}

test("help lists the built-in commands, then the adapter's when one is given", () => {
  const plain = help('jankless');
  expect(plain).toContain('Usage: npx jankless <command> [options]');
  expect(plain).toContain('measure     Measure an interaction');
  expect(plain).toContain('playwright-jankless adds calibrate and init-agents');

  const adapter: Adapter = {
    name: 'test-adapter',
    launch: () => Promise.reject(new Error('not used')),
    commands: { tidy: { summary: 'Tidy the results', run: () => 0 } },
  };
  expect(help('jankless', adapter)).toContain('  tidy        Tidy the results');
  expect(help('jankless', { ...adapter, commands: undefined })).not.toContain('adds calibrate');
});

test("an adapter's command runs with its arguments, and an unknown one fails with the help", async () => {
  const seen: string[][] = [];
  const adapter: Adapter = {
    name: 'test-adapter',
    launch: () => Promise.reject(new Error('not used')),
    commands: {
      tidy: {
        summary: 'Tidy the results',
        run: (args) => {
          seen.push(args);
          return 3;
        },
      },
    },
  };
  expect((await run(['tidy', '--all'], adapter)).code).toBe(3);
  expect(seen).toEqual([['--all']]);

  const unknown = await run(['polish'], adapter);
  expect(unknown.code).toBe(1);
  expect(unknown.err).toContain("Unknown command 'polish'.");
  expect(unknown.err).toContain('  tidy        Tidy the results');
});

test('measure with a failing adapter reports why, without a stack trace', async () => {
  const adapter: Adapter = {
    name: 'test-adapter',
    launch: () => Promise.reject(new Error('the browser is not installed')),
  };
  const r = await run(['measure', 'http://localhost:4173/', '--click', '#a', '--dir', dir], adapter);
  expect(r.code).toBe(1);
  expect(r.err).toBe("Couldn't measure http://localhost:4173/: the browser is not installed");
});
