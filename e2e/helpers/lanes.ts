// The two E2E lanes (#595).
//
//  - **smoke** — a small, high-value subset tagged `@smoke`, fast enough to run
//    on every pull request. It is a regression *gate*, not coverage: auth,
//    cross-user ownership, API validation, the core transaction flow, one
//    maturity/merge money path, and the report download.
//  - **full**  — every spec (~258 tests, ~7.6 min serial). Runs nightly and on
//    demand, never on the PR path.
//
// This module is intentionally dependency-free so it can be imported by the
// Playwright config, the lane reporter, and the Vitest unit test (which lives
// outside the e2e/ tree Vitest otherwise excludes).

/** Playwright tag marking a test as part of the PR smoke lane. */
export const SMOKE_TAG = '@smoke'

/**
 * Documented wall-clock budget for the smoke lane, covering the whole
 * Playwright run (setup project + tests). The full suite takes ~7.6 min; the
 * smoke lane must stay a small fraction of that or it stops being a PR gate.
 * The lane reporter prints a warning when a run overruns this.
 */
export const SMOKE_BUDGET_MS = 3 * 60_000

/** The lane is only useful inside this size band — see #595. */
export const SMOKE_MIN_TESTS = 15
export const SMOKE_MAX_TESTS = 30

/**
 * Areas the smoke lane must keep guarding, and the spec that carries them.
 * A unit test fails if any area loses its `@smoke` tags, so shrinking the lane
 * can't silently drop a whole category of regression.
 */
export const SMOKE_COVERAGE_AREAS = [
  { name: 'auth / session', spec: 'auth.spec.ts' },
  { name: 'cross-user ownership', spec: 'fk-ownership.spec.ts' },
  { name: 'API validation', spec: 'api-validation.spec.ts' },
  { name: 'core transaction flow', spec: 'dashboard.spec.ts' },
  { name: 'add-transaction entry point', spec: 'add-transaction.spec.ts' },
  { name: 'maturity / merge money path', spec: 'maturity-combine-merge.spec.ts' },
  { name: 'report download', spec: 'report.spec.ts' },
  { name: 'navigation', spec: 'navigation.spec.ts' },
] as const

export type SmokeBudgetVerdict = {
  withinBudget: boolean
  /** Milliseconds over the budget; 0 when within it. */
  overByMs: number
  budgetMs: number
  durationMs: number
}

/** Compare a finished run's wall-clock duration against the documented budget. */
export function checkSmokeBudget(
  durationMs: number,
  budgetMs: number = SMOKE_BUDGET_MS,
): SmokeBudgetVerdict {
  const overByMs = Math.max(0, durationMs - budgetMs)
  return { withinBudget: overByMs === 0, overByMs, budgetMs, durationMs }
}
