#!/usr/bin/env node
// npx playwright-butter-mcp [--dir <folder>] [--results <dir>]
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createServer } from './server.js';

const HELP = `Usage: npx playwright-butter-mcp [options]

Starts the playwright-butter MCP server on standard input and output, for a coding agent.
Run it from the project being worked on.

Options:
  --dir <folder>    Where baselines and results are kept (default: the project's
                    node_modules/.cache/playwright-butter/adhoc)
  --results <dir>   Playwright's output directory, for results from tests (default test-results)
  --help            Show this help
`;

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    results: { type: 'string' },
    help: { type: 'boolean' },
  },
});

if (values.help) {
  console.log(HELP);
} else {
  // Standard output carries the protocol, so nothing else is written to it.
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  };
  const server = createServer({ dir: values.dir, results: values.results, version });
  await server.connect(new StdioServerTransport());
}
