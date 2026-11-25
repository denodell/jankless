// The frames a replay would be made from, kept with a result until the test body has finished
// and toBeSmooth() has decided whether a replay is wanted. Not part of the JSON result.
import type { JanklessResult } from '../types.js';
import type { ReplayInput } from './encode.js';

const sources = new WeakMap<JanklessResult, ReplayInput>();

export function setReplaySource(result: JanklessResult, source: ReplayInput): void {
  sources.set(result, source);
}

/** Returns the frames and forgets them (several MB). */
export function takeReplaySource(result: JanklessResult): ReplayInput | undefined {
  const s = sources.get(result);
  sources.delete(result);
  return s;
}

/** The frames kept for a result's replay, without forgetting them. */
export function peekReplaySource(result: JanklessResult): ReplayInput | undefined {
  return sources.get(result);
}
