// npx playwright-jankless <command>: the same commands as `npx jankless` (the engine's), with
// this package as the adapter. It adds two that need Playwright:
// npx playwright-jankless calibrate [--runs 5] [--out jankless-calibration.json] [-- <playwright test args>]
// npx playwright-jankless init-agents [--dir <folder>]... [--no-agents-md]
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
  CALIBRATE_ENV,
  TOOL_NAME,
  calibrate,
  formatCalibration,
  forwardSlashes,
  type AdapterCommand,
  type JanklessResult,
} from 'jankless';
import { jsonFiles } from 'jankless/cli';
import { PACKAGE_NAME } from './constants.js';
import { SKILL_DIRS, initAgents } from './init-agents.js';

const CALIBRATE_HELP = `Usage: npx ${PACKAGE_NAME} calibrate [options] [-- <playwright test arguments>]

Runs your Playwright suite several times on unchanged code, and prints how much each
check varies between runs, with a suggested maxIncrease for each.

Options:
  --runs <n>     How many times to run the suite (default 5, at least 2)
  --out <file>   Where to write the results as JSON (default jankless-calibration.json)
  --help         Show this help

Example:
  npx ${PACKAGE_NAME} calibrate --runs 5 -- --project=chromium tests/lists.spec.ts
`;

function collect(outputDir: string): Map<string, JanklessResult> {
  const root = join(outputDir, 'jankless');
  const results = new Map<string, JanklessResult>();
  for (const file of jsonFiles(root)) {
    const id = forwardSlashes(relative(root, file));
    if (/-retry\d+\//.test(id)) continue; // a retry is a different attempt, not another sample
    try {
      const r = JSON.parse(readFileSync(file, 'utf8')) as JanklessResult;
      if (r.schemaVersion === 1) results.set(id, r);
    } catch {
      // unreadable file: skipped
    }
  }
  return results;
}

const INIT_AGENTS_HELP = `Usage: npx ${PACKAGE_NAME} init-agents [options]

Adds the ${PACKAGE_NAME} skill to this project, so coding agents know how to fix a
check that got worse: read the fix brief, record a baseline, make the change, and prove it.
It goes in ${SKILL_DIRS.join(' and ')}, and AGENTS.md gets a short section pointing to it.
Run it again after upgrading to update the skill.

Options:
  --dir <folder>    Where skills go, instead of the defaults (repeat for more than one)
  --no-agents-md    Leave AGENTS.md alone
  --help            Show this help
`;

function initAgentsCommand(args: string[]): number {
  const { values } = parseArgs({
    args,
    options: {
      dir: { type: 'string', multiple: true },
      'no-agents-md': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(INIT_AGENTS_HELP);
    return 0;
  }
  const written = initAgents({
    cwd: process.cwd(),
    dirs: values.dir ?? SKILL_DIRS,
    agentsMd: !values['no-agents-md'],
  });
  console.log(`Added the ${PACKAGE_NAME} skill:\n${written.map((w) => `  ${w}`).join('\n')}`);
  return 0;
}

function calibrateCommand(rest: string[]): number {
  const dash = rest.indexOf('--');
  const own = dash < 0 ? rest : rest.slice(0, dash);
  const passthrough = dash < 0 ? [] : rest.slice(dash + 1);
  const { values } = parseArgs({
    args: own,
    options: {
      runs: { type: 'string', default: '5' },
      out: { type: 'string', default: 'jankless-calibration.json' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(CALIBRATE_HELP);
    return 0;
  }
  const runs = Number(values.runs);
  if (!Number.isInteger(runs) || runs < 2) {
    console.error('--runs must be a whole number, 2 or more.');
    return 1;
  }

  // Playwright's CLI script, from the project being calibrated. It's run with node directly:
  // on Windows, Node won't spawn npx.cmd without a shell.
  let playwrightCli: string;
  try {
    playwrightCli = createRequire(join(process.cwd(), 'package.json')).resolve('@playwright/test/cli');
  } catch {
    console.error("Couldn't find @playwright/test in this project. Run calibrate from the project's folder.");
    return 1;
  }
  const work = mkdtempSync(join(tmpdir(), 'jankless-calibrate-'));
  const collected: Map<string, JanklessResult>[] = [];
  try {
    for (let i = 1; i <= runs; i++) {
      const outputDir = join(work, `run-${i}`);
      console.log(`Run ${i} of ${runs}…`);
      const child = spawnSync(
        process.execPath,
        [playwrightCli, 'test', `--output=${outputDir}`, ...passthrough],
        {
          stdio: ['ignore', 'ignore', 'inherit'],
          env: { ...process.env, [CALIBRATE_ENV]: '1' },
        },
      );
      if (child.error) {
        console.error(`Couldn't run Playwright: ${child.error.message}`);
        return 1;
      }
      const results = collect(outputDir);
      if (child.status !== 0)
        console.warn(`  Run ${i}: some tests failed; their jankless results are still used.`);
      console.log(`  ${results.size} jankless result(s)`);
      collected.push(results);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  const checks = calibrate(collected);
  console.log('\n' + formatCalibration(checks, runs));
  writeFileSync(
    values.out!,
    JSON.stringify(
      { schemaVersion: 1, kind: `${TOOL_NAME}-calibration`, invocations: runs, checks },
      null,
      2,
    ) + '\n',
  );
  console.log(`Written to ${values.out}`);
  return 0;
}

/** The commands this adapter adds to the `jankless` command line. */
export const commands: Record<string, AdapterCommand> = {
  calibrate: {
    summary: 'How much each check varies between runs, with a suggested maxIncrease',
    run: calibrateCommand,
  },
  'init-agents': {
    summary: 'Add the skill that teaches coding agents to fix what the checks find',
    run: initAgentsCommand,
  },
};
