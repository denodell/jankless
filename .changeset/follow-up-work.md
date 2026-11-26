---
'playwright-jankless': minor
'jankless': minor
---

Work that an input starts later is now measured as that input's work.

- A long frame that starts within a second after an input, an interaction's paint or a scroll event is an interaction frame. A debounced handler, a `setTimeout` and a fetch that renders when it returns used to be classified as background work and left out, so a click that did 200ms of work in a timer was reported as smooth.
- `measure()` and `scroll()` keep collecting until half a second after the action's last input, so each run can take up to half a second longer.
- Results can change for tests whose interactions start work in a timer or a promise: `longFrames` may go up. Baselines recorded before this version may need recording again, and automatic mode's history catches up over its next runs on main.
- `jankless`'s collector snapshot has a new `inputs` field: when each pointer press and key happened.
