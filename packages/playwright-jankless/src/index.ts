import type { Page } from '@playwright/test';
import type { ResetStrategy as CoreResetStrategy } from 'jankless';

export { test } from './fixture.js';
export { withJankless } from './withJankless.js';
export type { AutoOptions } from './withJankless.js';
export type { Jankless, JanklessFixtures, JanklessTestOptions, JanklessOptions } from './fixture.js';
export { expect } from './matcher.js';
export { PACKAGE_NAME } from './constants.js';
export { SCHEMA_VERSION } from 'jankless';
// The result and option types, from the engine. JanklessOptions and ResetStrategy are the
// Playwright forms, which pass a Playwright Page to a reset function.
export type {
  BaselineInfo,
  Budget,
  Budget120Result,
  BudgetCheck,
  BudgetStatus,
  Check,
  CheckStatus,
  Comparison,
  ComparisonStatus,
  Enforce,
  FramesResult,
  HeadlessMode,
  HotFunction,
  InputResult,
  ListOptions,
  ListResult,
  LongFramesResult,
  MatcherOptions,
  ProfileResult,
  ReplayMode,
  ResolvedOptions,
  ScrollOptions,
  JanklessMode,
  JanklessResult,
  Spread,
  TargetTiming,
  TopScript,
  Unavailable,
} from 'jankless';
export type ResetStrategy = CoreResetStrategy<Page>;
