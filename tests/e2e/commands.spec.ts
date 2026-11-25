// The built commands as they're run: `jankless`, and the MCP server as an agent starts it,
// talking over standard input and output. Both find the Playwright adapter themselves, as
// they do in a project that has it installed. Needs `npm run build` first.
import { test, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BIN = resolve('packages', 'jankless-mcp', 'dist', 'bin.js');
const built = existsSync(BIN);

test('--help describes the command and starts no server', () => {
  test.skip(!built, 'dist/ not built; run npm run build');
  const child = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8', timeout: 30_000 });
  expect(child.status).toBe(0);
  expect(child.stdout).toContain('Usage: npx jankless-mcp [options]');
  expect(child.stdout).toContain('--dir <folder>');
});

test('over standard input and output: its name, its version and its three tools', async () => {
  test.skip(!built, 'dist/ not built; run npm run build');
  const dir = mkdtempSync(join(tmpdir(), 'jankless-mcp-bin-'));
  const client = new Client({ name: 'test', version: '0' });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [BIN, '--dir', dir, '--results', join(dir, 'test-results')],
        env: process.env as Record<string, string>,
      }),
    );
    const { version } = JSON.parse(
      readFileSync(resolve('packages', 'jankless-mcp', 'package.json'), 'utf8'),
    ) as { version: string };
    expect(client.getServerVersion()).toMatchObject({ name: 'jankless', version });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'compare_baseline',
      'get_hot_functions',
      'measure_interaction',
    ]);
    // --dir is used: nothing has been measured in the empty folder.
    const r = (await client.callTool({
      name: 'get_hot_functions',
      arguments: { label: 'open filters' },
    })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain('Nothing has been measured yet');
  } finally {
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

const JANKLESS = resolve('packages', 'jankless', 'dist', 'bin.js');

test('npx jankless measure finds the installed adapter and measures a click', ({ baseURL }) => {
  test.skip(!existsSync(JANKLESS), 'dist/ not built; run npm run build');
  test.setTimeout(120_000);
  const dir = mkdtempSync(join(tmpdir(), 'jankless-bin-'));
  try {
    const child = spawnSync(
      process.execPath,
      [JANKLESS, 'measure', `${baseURL}/click.html?ms=150`, '--click', '#heavy', '--runs', '1', '--dir', dir],
      { encoding: 'utf8', timeout: 100_000 },
    );
    expect(child.stderr).toBe('');
    expect(child.status).toBe(0);
    expect(child.stdout).toContain('"click #heavy on /click.html?ms=150": baseline recorded.');
    expect(child.stdout).toContain('slowest: click on button#heavy');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("npx jankless runs the adapter's commands too", () => {
  test.skip(!existsSync(JANKLESS), 'dist/ not built; run npm run build');
  const help = spawnSync(process.execPath, [JANKLESS, 'calibrate', '--help'], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  expect(help.status).toBe(0);
  expect(help.stdout).toContain('Runs your Playwright suite several times on unchanged code');
  const unknown = spawnSync(process.execPath, [JANKLESS, 'polish'], { encoding: 'utf8', timeout: 30_000 });
  expect(unknown.status).toBe(1);
  expect(unknown.stderr).toContain("Unknown command 'polish'.");
  expect(unknown.stderr).toContain('calibrate   How much each check varies');
});

test('the MCP server measures through the installed adapter', async ({ baseURL }) => {
  test.skip(!built, 'dist/ not built; run npm run build');
  test.setTimeout(120_000);
  const dir = mkdtempSync(join(tmpdir(), 'jankless-mcp-bin-'));
  const client = new Client({ name: 'test', version: '0' });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [BIN, '--dir', dir],
        env: process.env as Record<string, string>,
      }),
    );
    const r = (await client.callTool(
      {
        name: 'measure_interaction',
        arguments: {
          url: `${baseURL}/click.html?ms=150`,
          steps: [{ action: 'click', selector: '#heavy' }],
          runs: 1,
        },
      },
      undefined,
      { timeout: 100_000 },
    )) as { isError?: boolean; content: { text: string }[]; structuredContent?: Record<string, unknown> };
    expect(r.content[0]!.text).toContain('baseline recorded. Measure it again after a change');
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ verdict: 'baseline-recorded', runs: 1 });
  } finally {
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
