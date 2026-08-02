import type {
  Reporter,
  TestCase,
  TestResult,
  TestError,
  FullResult,
} from '@playwright/test/reporter'
import { summarizeFailures, type FailureInput } from '../helpers/failureClass'
import { checkSmokeBudget, SMOKE_BUDGET_MS } from '../helpers/lanes'

type Failure = FailureInput & { title: string }

/**
 * Prints a run summary that separates infrastructure trouble (database
 * throttling, socket errors, a browser that died) from product regressions, and
 * — on the smoke lane — checks the run against its documented time budget
 * (#595).
 *
 * It never changes the exit code: a red run stays red. The point is that the
 * *reason* is legible at a glance, so a throttled database is not mistaken for
 * an app regression.
 */
class LaneReporter implements Reporter {
  private failures: Failure[] = []
  private startedAt = 0
  private finished = 0
  private lane = process.env.E2E_LANE ?? 'full'

  onBegin() {
    this.startedAt = Date.now()
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this.finished += 1
    if (result.status === 'passed' || result.status === 'skipped') return
    if (result.status === test.expectedStatus) return
    // Retries: only the final attempt matters.
    if (result.retry < test.retries) return

    this.failures.push({
      title: test.titlePath().filter(Boolean).join(' › '),
      status: result.status,
      message: [result.error?.message, result.error?.stack, ...result.errors.map((e) => e.message)]
        .filter(Boolean)
        .join('\n'),
    })
  }

  /**
   * Global errors never reach `onTestEnd` — a webServer that won't start, a
   * config that won't load, a worker that died before any test ran. Without
   * this, exactly the failure the infra classifier is best at spotting would be
   * missing from the summary.
   */
  onError(error: TestError) {
    this.failures.push({
      title: 'global error (no test)',
      status: 'failed',
      message: [error.message, error.stack, error.value].filter(Boolean).join('\n'),
    })
  }

  onEnd(result: FullResult) {
    // Nothing ran and nothing failed — e.g. `playwright test --list`. Stay quiet.
    if (this.finished === 0 && this.failures.length === 0) return

    const durationMs = Date.now() - this.startedAt
    const lines: string[] = ['', `E2E lane: ${this.lane} — ${formatDuration(durationMs)}`]

    // A run that never got as far as a test says nothing about the budget.
    if (this.lane === 'smoke' && this.finished > 0) {
      const verdict = checkSmokeBudget(durationMs)
      lines.push(
        verdict.withinBudget
          ? `  ✓ within the ${formatDuration(SMOKE_BUDGET_MS)} smoke budget`
          : `  ! over the ${formatDuration(SMOKE_BUDGET_MS)} smoke budget by ${formatDuration(
              verdict.overByMs,
            )} — trim the lane or move a test down a layer`,
      )
    }

    const summary = summarizeFailures(this.failures)
    if (summary.total > 0) {
      lines.push(
        `  ${summary.product.length} product failure(s), ${summary.infra.length} infra failure(s)`,
      )
      for (const failure of summary.product) lines.push(`    ✗ product: ${failure.title}`)
      for (const failure of summary.infra) lines.push(`    ~ infra:   ${failure.title}`)
      if (summary.infraOnly) {
        lines.push(
          '  Every failure looks like infrastructure (database throttling, network, browser),',
          '  not a product regression. Re-run against a healthy stack before chasing the app.',
        )
      }
    } else if (result.status === 'passed') {
      lines.push('  no failures')
    }

    console.log(lines.join('\n'))

    if (process.env.GITHUB_STEP_SUMMARY && summary.total > 0) {
      const marker = summary.infraOnly ? 'warning' : 'error'
      console.log(
        `::${marker} title=E2E ${this.lane} lane::${summary.product.length} product failure(s), ` +
          `${summary.infra.length} infra failure(s)`,
      )
    }
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`
}

export default LaneReporter
