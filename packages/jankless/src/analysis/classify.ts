import type { LoafRecord, LoafScriptRecord, ScrollRecord } from '../collector/collector.js';
import type { Interaction } from './interactions.js';

export type FrameClass = 'interaction' | 'load' | 'background';

/** Frames starting before loadEventEnd plus this grace period are load frames. */
export const LOAD_GRACE_MS = 50;

/**
 * A scroll event recorded this many ms before a frame starts still belongs to that frame:
 * the listener runs at the start of the frame that handles the scroll.
 */
export const SCROLL_LEAD_MS = 5;

/**
 * Event Timing start times and LoAF start times are both rounded, so a frame that handles an
 * input can appear to start a moment before it.
 */
const INPUT_START_TOLERANCE_MS = 2;

/**
 * Work an input starts later still belongs to it: a debounced search, a `setTimeout`, a fetch
 * that renders when it returns. A long frame that starts within this many ms after an
 * input, an interaction's paint or a scroll event is an interaction frame.
 */
export const FOLLOW_UP_MS = 1000;

export interface ClassifyInput {
  loaf: LoafRecord[];
  interactions: Interaction[];
  scrolls: ScrollRecord[];
  loadEventEnd: number;
  /** When each raw input happened. Event Timing has no entry for an input that painted in under 16ms. */
  inputs?: number[];
}

/**
 * A `setInterval` callback: periodic by construction, so never caused by one interaction, even
 * when it happens to run inside an interaction's window. (Work a handler triggers uses
 * setTimeout, requestAnimationFrame or promises.)
 */
export function isPeriodic(s: LoafScriptRecord): boolean {
  return s.invoker.startsWith('TimerHandler:setInterval');
}

/**
 * True for a script that was already running (or ran) before the frame's input arrived, and isn't
 * an event listener: a timer or other work the input interrupted, not something it caused.
 */
export function ranBeforeInput(s: LoafScriptRecord, firstUIEventTimestamp: number): boolean {
  return (
    firstUIEventTimestamp > 0 &&
    s.start >= 0 &&
    s.start + INPUT_START_TOLERANCE_MS < firstUIEventTimestamp &&
    s.invokerType !== 'event-listener'
  );
}

/**
 * Classifies each long frame without labels from the test, in this order:
 * 1. `firstUIEventTimestamp > 0` (an input arrived for this frame), and either the input was
 *    already waiting when the frame started, or some script ran after it arrived. A timer frame
 *    that a click merely interrupted also gets a firstUIEventTimestamp, but nothing in it ran
 *    because of the click.
 * 2. It starts during an Event Timing interaction window. A frame that started before the input
 *    arrived can't have been caused by it: it delayed the input, which the interaction's
 *    input-to-paint time already includes.
 * 3. A scroll event fired during it.
 * 4. It started before load finished (plus LOAD_GRACE_MS).
 * 5. It started within FOLLOW_UP_MS after an input, an interaction's paint or a scroll event: work
 *    the input started later, with a timer or a promise.
 * 6. An `event-listener` script ran in it (a secondary signal: input the other rules missed).
 * 7. Otherwise, background.
 *
 * Before all of these: a frame made only of `setInterval` callbacks is never an interaction frame.
 */
export function classifyFrame(f: LoafRecord, input: Omit<ClassifyInput, 'loaf'>): FrameClass {
  const end = f.start + f.duration;
  if (f.scripts.length > 0 && f.scripts.every(isPeriodic)) {
    return input.loadEventEnd === 0 || f.start < input.loadEventEnd + LOAD_GRACE_MS ? 'load' : 'background';
  }
  if (f.firstUIEventTimestamp > 0) {
    const waiting = f.firstUIEventTimestamp <= f.start + INPUT_START_TOLERANCE_MS;
    const ranAfter =
      f.scripts.length === 0 || f.scripts.some((s) => !ranBeforeInput(s, f.firstUIEventTimestamp));
    if (waiting || ranAfter) return 'interaction';
  }
  if (
    input.interactions.some(
      (i) => f.start >= i.start - INPUT_START_TOLERANCE_MS && f.start < i.start + i.duration,
    )
  ) {
    return 'interaction';
  }
  if (input.scrolls.some((s) => s.t >= f.start - SCROLL_LEAD_MS && s.t <= end)) return 'interaction';
  // loadEventEnd is 0 until the page has finished loading.
  if (input.loadEventEnd === 0 || f.start < input.loadEventEnd + LOAD_GRACE_MS) return 'load';
  const followsUp = (inputEnd: number) => f.start >= inputEnd && f.start < inputEnd + FOLLOW_UP_MS;
  if (
    input.interactions.some((i) => followsUp(i.start + i.duration)) ||
    input.scrolls.some((s) => followsUp(s.t)) ||
    (input.inputs ?? []).some(followsUp)
  ) {
    return 'interaction';
  }
  if (
    f.scripts.some(
      (s) =>
        s.invokerType === 'event-listener' &&
        /\.on(pointer|mouse|key|click|touch|wheel|scroll|input)/.test(s.invoker),
    )
  ) {
    return 'interaction';
  }
  return 'background';
}

export function classifyFrames(input: ClassifyInput): FrameClass[] {
  return input.loaf.map((f) => classifyFrame(f, input));
}
