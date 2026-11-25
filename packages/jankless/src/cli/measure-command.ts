// npx jankless measure <url> [steps | --scroll <selector>] [options]
import { parseArgs } from 'node:util';
import { isAbsolute, relative } from 'node:path';
import { forwardSlashes } from '../output.js';
import type { Adapter } from '../adapter.js';
import type { AdhocOutcome, AdhocRequest, Step } from '../adhoc.js';

/** The help text, for the command name it was run as. */
export const measureHelp = (command: string) => `Usage: npx ${command} measure <url> [steps] [options]

Measures an interaction or a scroll on a running page, with no spec file, and compares it
with the last baseline recorded under the same label. The first run records the baseline.

Steps, measured in the order they're given:
  --click <selector>     Click an element
  --hover <selector>     Move the mouse over an element
  --type <text>          Type into the focused element, one key at a time
  --press <key>          Press a key, such as Enter or ArrowDown
  --wait <ms>            Wait
  --steps <json>         The steps as JSON instead, such as
                         '[{"action":"type","selector":"#search","text":"abc"}]'

Or a scroll, in place of steps:
  --scroll <selector>    Scroll a list, or html for the page
  --distance <px|end>    How far (default end, at most 20,000px)
  --speed <speed>        slow, normal (default), fast, or pixels per second
  --input <input>        wheel (default), touch or keys
  --direction <dir>      vertical (default) or horizontal

Options:
  --setup <json>         Steps to run after each page load, before measuring
  --label <name>         Names the baseline (default: built from the URL and the steps)
  --baseline <use>       compare (default), record to replace the baseline, or off
  --mode <mode>          quick (default) or full, which adds dropped frames and a CPU profile
  --runs <n>             Measured runs (default 5)
  --cpu <n>              How many times slower the CPU runs (default 4; 1 disables it)
  --max-increase <n>     Allowed increase over the baseline (default 0.15)
  --budget <json>        Fixed limits, such as '{"maxLongFrames":0}'
  --enforce <enforce>    warn (default), or fail to exit with 1 when it got worse
  --dir <folder>         Where baselines and results are kept
  --headed               Show the browser window
  --adapter <package>    The browser adapter to use, such as chrome-jankless
                         (default: the first one installed)
  --json                 Print the outcome as JSON
  --help                 Show this help

Examples:
  npx ${command} measure http://localhost:5173/products --click "#filters"
  npx ${command} measure http://localhost:5173/feed --scroll "#feed" --mode full
`;

const STEP_FLAGS = ['click', 'hover', 'type', 'press', 'wait'] as const;
type StepFlag = (typeof STEP_FLAGS)[number];

export interface MeasureArgs {
  request: AdhocRequest;
  json: boolean;
  enforce: 'warn' | 'fail';
  /** The adapter package named with --adapter. */
  adapter?: string;
}

const usage = (message: string): never => {
  throw new Error(message);
};

function json(value: string, flag: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return usage(`--${flag} must be JSON.`);
  }
}

function number(value: string, flag: string): number {
  const n = Number(value);
  if (value.trim() === '' || !Number.isFinite(n)) usage(`--${flag} must be a number, got '${value}'.`);
  return n;
}

function stepOf(flag: StepFlag, value: string): Step {
  switch (flag) {
    case 'click':
    case 'hover':
      return { action: flag, selector: value };
    case 'type':
      return { action: 'type', text: value };
    case 'press':
      return { action: 'press', key: value };
    case 'wait':
      return { action: 'wait', ms: number(value, 'wait') };
  }
}

/** Turns the command's arguments into a request. Returns null for --help. */
export function parseMeasureArgs(args: string[]): MeasureArgs | null {
  const { values, positionals, tokens } = parseArgs({
    args,
    allowPositionals: true,
    tokens: true,
    options: {
      click: { type: 'string', multiple: true },
      hover: { type: 'string', multiple: true },
      type: { type: 'string', multiple: true },
      press: { type: 'string', multiple: true },
      wait: { type: 'string', multiple: true },
      steps: { type: 'string' },
      scroll: { type: 'string' },
      distance: { type: 'string' },
      speed: { type: 'string' },
      input: { type: 'string' },
      direction: { type: 'string' },
      setup: { type: 'string' },
      label: { type: 'string' },
      baseline: { type: 'string' },
      mode: { type: 'string' },
      runs: { type: 'string' },
      cpu: { type: 'string' },
      'max-increase': { type: 'string' },
      budget: { type: 'string' },
      enforce: { type: 'string', default: 'warn' },
      dir: { type: 'string' },
      headed: { type: 'boolean' },
      adapter: { type: 'string' },
      json: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) return null;
  if (positionals.length !== 1) usage('Give one URL to measure.');
  if (values.enforce !== 'warn' && values.enforce !== 'fail') {
    usage(`--enforce must be warn or fail, got '${values.enforce}'.`);
  }

  // Step flags keep the order they were typed in.
  const flagged = tokens
    .filter((t) => t.kind === 'option' && (STEP_FLAGS as readonly string[]).includes(t.name))
    .map((t) => stepOf((t as { name: StepFlag }).name, (t as { value?: string }).value ?? ''));
  if (flagged.length && values.steps !== undefined) usage('Give step flags or --steps, not both.');
  const given = values.steps !== undefined ? json(values.steps, 'steps') : flagged;
  if (!Array.isArray(given))
    usage('--steps must be a JSON array, such as \'[{"action":"click","selector":"#open"}]\'.');
  const steps = given as Step[];

  const scrollFlags = ['distance', 'speed', 'input', 'direction'] as const;
  if (values.scroll === undefined) {
    const stray = scrollFlags.find((f) => values[f] !== undefined);
    if (stray) usage(`--${stray} goes with --scroll.`);
  }
  const named = (v: string) => (/^\d+(\.\d+)?$/.test(v) ? Number(v) : v);

  const request: AdhocRequest = { url: positionals[0]! };
  if (values.scroll !== undefined) {
    if (steps.length) usage('Give steps or --scroll, not both.');
    request.scroll = {
      selector: values.scroll,
      ...(values.distance !== undefined ? { distance: named(values.distance) as 'end' | number } : {}),
      ...(values.speed !== undefined ? { speed: named(values.speed) as 'normal' | number } : {}),
      ...(values.input !== undefined ? { input: values.input as 'wheel' } : {}),
      ...(values.direction !== undefined ? { direction: values.direction as 'vertical' } : {}),
    };
  } else {
    if (!steps.length) usage('Give the steps to measure, such as --click "#open", or a --scroll.');
    request.steps = steps;
  }
  if (values.setup !== undefined) request.setup = json(values.setup, 'setup') as Step[];
  if (values.label !== undefined) request.label = values.label;
  if (values.baseline !== undefined) request.baseline = values.baseline as 'compare';
  if (values.mode !== undefined) request.mode = values.mode as 'quick';
  if (values.runs !== undefined) request.runs = number(values.runs, 'runs');
  if (values.cpu !== undefined) request.cpuThrottling = number(values.cpu, 'cpu');
  if (values['max-increase'] !== undefined)
    request.maxIncrease = number(values['max-increase'], 'max-increase');
  if (values.budget !== undefined) request.budget = json(values.budget, 'budget') as AdhocRequest['budget'];
  if (values.dir !== undefined) request.dir = values.dir;
  if (values.headed) request.headed = true;
  return {
    request,
    json: !!values.json,
    enforce: values.enforce as 'warn' | 'fail',
    ...(values.adapter ? { adapter: values.adapter } : {}),
  };
}

/** Relative to the working directory when inside it, absolute otherwise. */
function shown(path: string): string {
  const rel = relative(process.cwd(), path);
  return forwardSlashes(rel.startsWith('..') || isAbsolute(rel) ? path : rel);
}

/** 1 when a budget was missed, or when the check got worse and `enforce` is `fail`. */
export function exitCodeOf(
  outcome: Pick<AdhocOutcome, 'verdict' | 'budget'>,
  enforce: 'warn' | 'fail',
): number {
  if (outcome.budget === 'missed') return 1;
  return outcome.verdict === 'worse' && enforce === 'fail' ? 1 : 0;
}

export const MEASURE_HELP = measureHelp('jankless');

export interface MeasureCommandOptions {
  /** The command name to show in help and errors. Default `jankless`. */
  command?: string;
  /** The adapter that opens the browser. Default: the one installed in this project. */
  adapter?: Adapter;
}

export async function measureCommand(args: string[], options: MeasureCommandOptions = {}): Promise<number> {
  const command = options.command ?? 'jankless';
  let parsed: MeasureArgs | null;
  try {
    parsed = parseMeasureArgs(args);
  } catch (err) {
    console.error(`${(err as Error).message}\n\nRun npx ${command} measure --help for the options.`);
    return 1;
  }
  if (!parsed) {
    console.log(measureHelp(command));
    return 0;
  }
  const { measureAdhoc, validateRequest } = await import('../adhoc.js');
  let outcome: AdhocOutcome;
  try {
    validateRequest(parsed.request);
  } catch (err) {
    console.error(`${(err as Error).message}\n\nRun npx ${command} measure --help for the options.`);
    return 1;
  }
  try {
    outcome = await measureAdhoc(parsed.request, {
      // --adapter names a package to load, in place of the adapter the command came with.
      ...(parsed.adapter ? { adapterPackages: [parsed.adapter] } : { adapter: options.adapter }),
    });
  } catch (err) {
    // An adapter's errors can be colored, as Playwright's call logs are.
    // eslint-disable-next-line no-control-regex
    const message = (err as Error).message.replace(/\u001b\[[0-9;]*m/g, '').trimEnd();
    console.error(`Couldn't measure ${parsed.request.url}: ${message}`);
    return 1;
  }
  if (parsed.json) {
    // The comparison is inside the result, and the text is for people.
    const { label, verdict, budget, resultFile, result } = outcome;
    console.log(JSON.stringify({ label, verdict, budget, resultFile, result }, null, 2));
  } else {
    console.log(outcome.text);
    console.log(`\nResult: ${shown(outcome.resultFile)}`);
  }
  return exitCodeOf(outcome, parsed.enforce);
}
