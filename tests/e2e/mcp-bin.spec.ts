// The MCP server as an agent starts it: the built `playwright-butter-mcp` command, talking over
// standard input and output. Needs `npm run build` first.
import { test, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BIN = resolve('packages', 'playwright-butter-mcp', 'dist', 'bin.js');
const built = existsSync(BIN);

test('--help describes the command and starts no server', () => {
  test.skip(!built, 'dist/ not built; run npm run build');
  const child = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8', timeout: 30_000 });
  expect(child.status).toBe(0);
  expect(child.stdout).toContain('Usage: npx playwright-butter-mcp [options]');
  expect(child.stdout).toContain('--dir <folder>');
});

test('over standard input and output: its name, its version and its three tools', async () => {
  test.skip(!built, 'dist/ not built; run npm run build');
  const dir = mkdtempSync(join(tmpdir(), 'butter-mcp-bin-'));
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
      readFileSync(resolve('packages', 'playwright-butter-mcp', 'package.json'), 'utf8'),
    ) as { version: string };
    expect(client.getServerVersion()).toMatchObject({ name: 'playwright-butter', version });
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
