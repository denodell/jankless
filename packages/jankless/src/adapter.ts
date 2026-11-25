// What a browser automation library provides so the engine can measure a URL with no test
// around it. playwright-jankless is the first adapter; the engine itself never imports one.
import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ElementTarget, PageDriver } from './driver.js';

/** One thing done to the page. Steps run in order. */
export type Step =
  | { action: 'click'; selector: string }
  | { action: 'hover'; selector: string }
  /** Types one key at a time, into `selector` when given, otherwise into the focused element. */
  | { action: 'type'; text: string; selector?: string }
  /** A key by its `KeyboardEvent.key` name, such as `Enter` or `ArrowDown`. */
  | { action: 'press'; key: string }
  | { action: 'wait'; ms: number };

/** Typing is spaced out, so each key is its own interaction, as it is for a person. */
export const TYPE_DELAY_MS = 100;

export interface LaunchOptions {
  /** Show the browser window. */
  headed: boolean;
  viewport: { width: number; height: number };
  /** A touch-enabled page. */
  touch: boolean;
  /** Which browser build to run, in the adapter's own terms. Default: the adapter's. */
  channel?: string;
}

/** One browser with one page, opened for one measurement. */
export interface AdapterBrowser {
  /** The page, as the engine drives it. */
  page: PageDriver;
  /**
   * Loads the URL from scratch, and resolves once it has loaded. Going to the URL the page is
   * already on, or to one that differs only in its hash, has to reload it.
   */
  open(url: string): Promise<void>;
  /** Does the steps in order, waiting for each element to be ready. */
  runSteps(steps: Step[]): Promise<void>;
  /** The element a scroll is measured on. */
  element(selector: string): ElementTarget;
  close(): Promise<void>;
}

/** A command the adapter adds to the `jankless` command line. */
export interface AdapterCommand {
  /** One line for the list of commands. */
  summary: string;
  run(args: string[]): number | Promise<number>;
}

export interface Adapter {
  /** The adapter's package name. */
  name: string;
  launch(options: LaunchOptions): Promise<AdapterBrowser>;
  /** Commands that only make sense with this adapter, by name. */
  commands?: Record<string, AdapterCommand>;
}

/** The adapters looked for, in order. Each exports `adapter` from `<package>/adapter`. */
export const ADAPTER_PACKAGES = ['playwright-jankless'];

export const NO_ADAPTER = `Measuring needs a browser adapter, and none is installed in this project. Add one:\n  npm install --save-dev ${ADAPTER_PACKAGES[0]}`;

/**
 * Finds an installed adapter: in the project the command runs in, then next to the command
 * itself. Throws with what to install when there is none.
 */
export async function loadAdapter(
  from: string = process.cwd(),
  script: string | null = process.argv[1] ?? null,
): Promise<Adapter> {
  const bases = [join(from, 'package.json')];
  // The command's own location, for an adapter installed beside it and not in the project.
  if (script && existsSync(script)) bases.push(join(dirname(realpathSync(script)), 'package.json'));
  for (const name of ADAPTER_PACKAGES) {
    for (const base of bases) {
      let path: string;
      try {
        path = createRequire(base).resolve(`${name}/adapter`);
      } catch {
        continue;
      }
      // `resolve` gives the CommonJS build. The ES module build beside it shares this engine.
      const esm = path.replace(/\.cjs$/, '.js');
      const mod = (await import(pathToFileURL(existsSync(esm) ? esm : path).href)) as {
        adapter?: Adapter;
        default?: { adapter?: Adapter };
      };
      const adapter = mod.adapter ?? mod.default?.adapter;
      if (adapter) return adapter;
    }
  }
  throw new Error(NO_ADAPTER);
}
