// The playwright-butter MCP server: three tools over playwright-butter's ad-hoc measurements
// (playwright-butter/adhoc), which do the measuring, comparing and wording. This file only
// describes the tools and passes their arguments on.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  defaultAdhocDir,
  findResult,
  formatHotFunctions,
  listLabels,
  measureAdhoc,
  readRecipe,
  remeasure,
  storedOutcome,
  summarize,
  type AdhocOutcome,
  type AdhocRequest,
} from 'playwright-butter/adhoc';

export const SERVER_NAME = 'playwright-butter';

export interface ServerOptions {
  /** Where ad-hoc baselines and results are kept. Default: playwright-butter's own default. */
  dir?: string;
  /** The Playwright output folder to look for test results in. Default `test-results`. */
  results?: string;
  /** The server's version, as reported to clients. */
  version?: string;
}

const INSTRUCTIONS = `Measures how smooth an interaction or a scroll is on a running web page, in Chromium, and whether a change made it better or worse.

To check a change:
1. Before changing any code, call measure_interaction with the page's URL and the steps or the scroll. The first call records a baseline and returns a label.
2. Make the change.
3. Call compare_baseline with that label. It measures again and says whether the page is less smooth, smoother, or shows no clear change.

Numbers belong to the machine they were measured on, so only compare results from this server with each other. "No clear change" means the difference is small enough to be noise: don't treat it as a win or a loss. Measure a production build when there is one, because a development build is often too slow to show a difference. For the functions behind a slow result, measure with mode "full" and call get_hot_functions.`;

const step = z.object({
  action: z
    .enum(['click', 'hover', 'type', 'press', 'wait'])
    .describe('click and hover need a selector, type needs text, press needs a key, wait needs ms.'),
  selector: z
    .string()
    .optional()
    .describe('A CSS selector, or any Playwright selector such as text=Save or role=button[name="Save"].'),
  text: z
    .string()
    .optional()
    .describe('For type: typed one key at a time, into the selector, or the focused element without one.'),
  key: z.string().optional().describe('For press: a key name, such as Enter or ArrowDown.'),
  ms: z.number().optional().describe('For wait: milliseconds, at most 30000.'),
});

const measureInput = {
  url: z
    .string()
    .describe('The page to measure, such as http://localhost:5173/products. It must be running.'),
  steps: z.array(step).optional().describe('The interaction to measure, in order. Give this or scroll.'),
  scroll: z
    .object({
      selector: z.string().optional().describe('The element that scrolls. Default html, the page itself.'),
      distance: z
        .union([z.literal('end'), z.number().positive()])
        .optional()
        .describe('Pixels, or end (the default, at most 20000px).'),
      speed: z
        .union([z.enum(['slow', 'normal', 'fast']), z.number().positive()])
        .optional()
        .describe('slow (1500px/s), normal (3000px/s, the default), fast (6000px/s), or pixels per second.'),
      input: z.enum(['wheel', 'touch', 'keys']).optional().describe('Default wheel.'),
      direction: z.enum(['vertical', 'horizontal']).optional().describe('Default vertical.'),
    })
    .optional()
    .describe('A scroll to measure instead of steps.'),
  setup: z
    .array(step)
    .optional()
    .describe(
      'Steps run after each page load and before measuring, such as opening the panel to measure in.',
    ),
  label: z
    .string()
    .optional()
    .describe(
      'Names the baseline. Default: built from the URL path and the steps, so the same call compares with itself.',
    ),
  mode: z
    .enum(['quick', 'full'])
    .optional()
    .describe(
      'quick (default) measures input-to-paint and long frames. full adds dropped frames and a CPU profile, and takes longer.',
    ),
  runs: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('Measured runs; the median is reported. Default 5.'),
  cpuThrottling: z
    .number()
    .min(1)
    .optional()
    .describe(
      'How many times slower the CPU runs, to stand in for a slower device. Default 4; 1 disables it.',
    ),
  baseline: z
    .enum(['compare', 'record', 'off'])
    .optional()
    .describe(
      'compare (default) compares with the baseline and records one if there is none. record replaces it. off only measures.',
    ),
  budget: z
    .object({
      maxInputToPaintMs: z.number().optional(),
      maxLongFrames: z.number().optional(),
      minOnTimePercent: z.number().optional().describe('Full mode only.'),
      maxBlankFramePercent: z.number().optional().describe('Full-mode scroll only.'),
    })
    .optional()
    .describe('Fixed limits to check on this run, baseline or not.'),
};

const outcomeOutput = {
  label: z.string(),
  verdict: z.enum(['worse', 'better', 'no-clear-change', 'baseline-recorded', 'not-compared', 'measured']),
  budget: z.enum(['met', 'missed']).nullable(),
  mode: z.enum(['quick', 'full']),
  runs: z.number(),
  cpuThrottling: z.number(),
  metrics: z.record(z.string(), z.number()),
  checks: z.array(
    z.object({
      metric: z.string(),
      name: z.string(),
      current: z.number().nullable(),
      baseline: z.number().nullable(),
      change: z.number().nullable(),
      changePercent: z.number().nullable(),
      status: z.enum(['worse', 'better', 'no-clear-change', 'unavailable', 'not-compared']),
      noisy: z.boolean(),
    }),
  ),
  slowest: z.object({ event: z.string(), target: z.string(), ms: z.number() }).nullable(),
  resultFile: z.string(),
};

/** Playwright colors its call logs, which an agent reads as noise. */
// eslint-disable-next-line no-control-regex
const plain = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '').trimEnd();

const failed = (message: string): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text: plain(message) }],
});

const answered = (outcome: AdhocOutcome, note = ''): CallToolResult => ({
  content: [{ type: 'text', text: note ? `${outcome.text}\n\n${note}` : outcome.text }],
  structuredContent: { ...summarize(outcome) },
});

export function createServer(options: ServerOptions = {}): McpServer {
  const dir = resolve(options.dir ?? defaultAdhocDir());
  const results = options.results ?? 'test-results';
  const server = new McpServer(
    { name: SERVER_NAME, version: options.version ?? '0.0.0' },
    { instructions: INSTRUCTIONS },
  );

  // One measurement at a time: two browsers measuring at once would take CPU from each other.
  let queue: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  };

  server.registerTool(
    'measure_interaction',
    {
      title: 'Measure an interaction or a scroll',
      description:
        'Opens a running page in Chromium, does the steps (or the scroll) several times with the CPU slowed, and reports how smooth it was: input-to-paint time, long frames and, in full mode, dropped frames. Compares with the baseline recorded under the same label, and records one on the first call. Call it before changing code, then call compare_baseline after each change.',
      inputSchema: measureInput,
      outputSchema: outcomeOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    (args) =>
      inTurn(async () => {
        try {
          return answered(await measureAdhoc({ ...(args as AdhocRequest), dir }));
        } catch (err) {
          return failed((err as Error).message);
        }
      }),
  );

  server.registerTool(
    'compare_baseline',
    {
      title: 'Measure again and compare with the baseline',
      description:
        'Runs a measurement again by its label, exactly as measure_interaction last ran it, and compares it with the baseline: less smooth, smoother, or no clear change. Use it after each change while working on a fix. For a label from a Playwright test instead, it returns the comparison the last test run stored.',
      inputSchema: {
        label: z.string().describe('The label measure_interaction returned, or a test check’s label.'),
        record: z
          .boolean()
          .optional()
          .describe('Replace the baseline with this measurement, once the new numbers are the ones to keep.'),
      },
      outputSchema: outcomeOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    ({ label, record }) =>
      inTurn(async () => {
        try {
          if (readRecipe(label, dir)) {
            return answered(await remeasure(label, { dir, baseline: record ? 'record' : 'compare' }));
          }
          const found = findResult(label, { dir, results });
          if (!found) return failed(unknownLabel(label, dir, results));
          const test = found.result.test;
          const rerun = test
            ? `This is what the last run of the test "${test.title}"${test.file ? ` (${test.file})` : ''} found. Run that test again to measure a change.`
            : 'This is what the last test run found. Run the test again to measure a change.';
          return answered(storedOutcome(found), rerun);
        } catch (err) {
          return failed((err as Error).message);
        }
      }),
  );

  server.registerTool(
    'get_hot_functions',
    {
      title: 'Where the time went',
      description:
        'For a label already measured: the functions that used the most CPU during the interaction, with their files, lines and callers (needs mode "full"), and the scripts that ran in its long frames. Reads the last result; it measures nothing.',
      inputSchema: {
        label: z.string().describe('A label from measure_interaction, or a test check’s label.'),
        limit: z.number().int().min(1).max(30).optional().describe('How many to list. Default 10.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ label, limit }) => {
      const found = findResult(label, { dir, results });
      if (!found) return failed(unknownLabel(label, dir, results));
      const { result } = found;
      const count = limit ?? 10;
      return {
        content: [{ type: 'text', text: formatHotFunctions(result, count) }],
        structuredContent: {
          label: result.label,
          mode: result.mode,
          sampledMs: result.profile?.sampledMs ?? null,
          hotFunctions: (result.profile?.hotFunctions ?? []).slice(0, count),
          scripts: (result.longFrames?.topScripts ?? []).slice(0, count),
        },
      };
    },
  );

  return server;
}

function unknownLabel(label: string, dir: string, results: string): string {
  const known = listLabels(dir);
  const list = known.length
    ? ` Measured so far: ${known.map((l) => `"${l}"`).join(', ')}.`
    : ' Nothing has been measured yet: call measure_interaction first.';
  return `Nothing has been measured as "${label}", and no check in ${results} has that label.${list}`;
}
