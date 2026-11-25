// npx jankless measure <url> [steps | --scroll <selector>] [options]  (measure-command.ts)
// npx jankless summary [--results test-results] [--out <file>] [--title <title>] [--github-summary]
// npx jankless brief [--results test-results] [--out <file>]
// An adapter adds its own commands: playwright-jankless adds calibrate and init-agents.
import { parseArgs } from 'node:util';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ADAPTER_PACKAGES, loadAdapter, type Adapter } from '../adapter.js';
import { buildMarkdown } from '../reporter/markdown.js';
import { filesEndingIn, jsonFiles, latestAttempts, readResults } from '../results.js';
import { measureCommand } from './measure-command.js';

export { jsonFiles, readResults };
export { measureCommand, parseMeasureArgs, exitCodeOf, MEASURE_HELP } from './measure-command.js';

export interface CliOptions {
  /** The command name to show in help and errors. Default `jankless`. */
  command?: string;
  /** The adapter to use. Default: the one installed in the project, found when it's needed. */
  adapter?: Adapter;
}

const BUILT_IN = `  measure     Measure an interaction or a scroll on a running page, with no spec file
  summary     The Markdown summary of the last run, from its result files
  brief       Every fix brief from the last run, in one document for a coding agent`;

/** The list of commands: the built-in ones, then the adapter's when it's known. */
export function help(command: string, adapter?: Adapter): string {
  const added = Object.entries(adapter?.commands ?? {}).map(
    ([name, c]) => `  ${name.padEnd(11)} ${c.summary}`,
  );
  const more = adapter
    ? added.length
      ? `\n${added.join('\n')}`
      : ''
    : `\n\nAn installed adapter adds its own commands: ${ADAPTER_PACKAGES[0]} adds calibrate and init-agents.`;
  return `Usage: npx ${command} <command> [options]

Commands:
${BUILT_IN}${more}

Run a command with --help for its options.
`;
}

const summaryHelp = (command: string) => `Usage: npx ${command} summary [options]

Writes the Markdown summary of the last run from its result files, the same summary the
reporter writes, for runs that didn't use the reporter.

Options:
  --results <dir>    Playwright's output directory (default test-results)
  --out <file>       Where to write it (default <results>/jankless/summary.md)
  --title <title>    The summary's heading (default Jankless)
  --github-summary   Also add it to the GitHub Actions job summary
  --help             Show this help
`;

const briefHelp = (command: string) => `Usage: npx ${command} brief [options]

Prints every fix brief from the last run as one document, for a coding agent. A brief is
written next to each check that got worse or missed its budget.

Options:
  --results <dir>   Playwright's output directory (default test-results)
  --out <file>      Write it to a file instead of printing it
  --help            Show this help
`;

export function collectBriefs(results: string): string {
  const briefs = latestAttempts(filesEndingIn(join(results, 'jankless'), '.fix.md')).map((f) =>
    readFileSync(f, 'utf8').trimEnd(),
  );
  if (!briefs.length) return '';
  const head =
    briefs.length === 1
      ? ''
      : `# ${briefs.length} jankless checks to fix\n\nEach section is one check. Fix and re-run them one at a time.\n\n`;
  return (
    head +
    briefs
      .map((b) =>
        briefs.length === 1 ? b : b.replace(/^# /gm, '## ').replace(/^## (?!Fix brief)/gm, '### '),
      )
      .join('\n\n') +
    '\n'
  );
}

function brief(args: string[], command: string): number {
  const { values } = parseArgs({
    args,
    options: {
      results: { type: 'string', default: 'test-results' },
      out: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(briefHelp(command));
    return 0;
  }
  const md = collectBriefs(values.results!);
  if (!md) {
    console.error('No fix briefs: no jankless check got worse or missed its budget in the last run.');
    return 0;
  }
  if (values.out) {
    mkdirSync(dirname(values.out), { recursive: true });
    writeFileSync(values.out, md);
    console.error(`Fix briefs written to ${values.out}`);
  } else {
    process.stdout.write(md);
  }
  return 0;
}

function summary(args: string[], command: string): number {
  const { values } = parseArgs({
    args,
    options: {
      results: { type: 'string', default: 'test-results' },
      out: { type: 'string' },
      title: { type: 'string' },
      'github-summary': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(summaryHelp(command));
    return 0;
  }
  const entries = readResults(values.results!);
  const out = values.out ?? join(values.results!, 'jankless', 'summary.md');
  const md = buildMarkdown(entries, values.title);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, md);
  const jobSummary = process.env.GITHUB_STEP_SUMMARY;
  if (values['github-summary'] && jobSummary) appendFileSync(jobSummary, md + '\n');
  console.log(`Jankless summary of ${entries.length} result(s): ${out}`);
  return 0;
}

/**
 * Runs one command. `measure` and an adapter's commands may open a browser or run a test suite,
 * so they return a promise of their exit code; `summary`, `brief` and help return theirs at once.
 */
export function main(argv: string[], options: CliOptions = {}): number | Promise<number> {
  const command = options.command ?? 'jankless';
  const [name, ...rest] = argv;
  if (!name || name === '--help' || name === '-h') {
    console.log(help(command, options.adapter));
    return name ? 0 : 1;
  }
  if (name === 'measure') return measureCommand(rest, { command, adapter: options.adapter });
  if (name === 'summary') return summary(rest, command);
  if (name === 'brief') return brief(rest, command);
  // With the adapter given, its commands answer at once. Otherwise it has to be found first.
  if (options.adapter) return runAdapterCommand(options.adapter, name, rest, command);
  return loadAdapter().then(
    (adapter) => runAdapterCommand(adapter, name, rest, command),
    () => {
      console.error(
        `Unknown command '${name}'. If it belongs to an adapter, none is installed in this project: add one with npm install --save-dev ${ADAPTER_PACKAGES[0]}.\n\n${help(command)}`,
      );
      return 1;
    },
  );
}

function runAdapterCommand(
  adapter: Adapter,
  name: string,
  args: string[],
  command: string,
): number | Promise<number> {
  const found = adapter.commands?.[name];
  if (!found) {
    console.error(`Unknown command '${name}'.\n\n${help(command, adapter)}`);
    return 1;
  }
  return found.run(args);
}
