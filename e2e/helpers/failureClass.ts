// Tell infrastructure trouble apart from real product regressions (#595).
//
// The E2E suite historically went red in CI because the shared Supabase Nano
// instance throttled (Disk IO budget, connection exhaustion, 5xx from the API
// gateway) — not because the app broke. A red lane that mixes those two causes
// trains everyone to ignore it. The lane reporter uses this classifier to print
// them in separate buckets, so "20 infra failures, 0 product failures" reads as
// "the database gave up", not "the app regressed".
//
// Dependency-free on purpose: imported by the Playwright reporter and by the
// Vitest unit test (which lives outside the e2e/ tree Vitest excludes).

export type FailureKind = 'infra' | 'product'

export type FailureInput = {
  title?: string
  message?: string
  status?: string
}

/**
 * Signals that the environment — network, database, browser process — failed,
 * rather than an assertion about the product.
 *
 * Deliberately *not* here: a bare "Timed out"/"Test timeout exceeded". That is
 * the suite's most common *product* failure (an element never appeared), so a
 * timeout only counts as infra when it carries one of these markers too.
 */
const INFRA_PATTERNS: RegExp[] = [
  // Socket / DNS level
  /\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|EHOSTUNREACH)\b/,
  /socket hang up/i,
  /fetch failed/i,
  /network error/i,
  /net::ERR_[A-Z_]+/,
  // Postgres / Supabase throttling and exhaustion
  /too many connections/i,
  /remaining connection slots/i,
  /statement timeout/i,
  /canceling statement due to/i,
  /disk io/i,
  /resource exhausted/i,
  // Gateway and rate-limit responses
  /\b(429|502|503|504)\b/,
  /too many requests/i,
  /service unavailable/i,
  /gateway timeout/i,
  /bad gateway/i,
  // The app server never came up at all
  /from config\.webServer to start/i,
  // Browser / worker died under us
  /browser has been closed/i,
  /browser closed unexpectedly/i,
  /target crashed/i,
  /page crashed/i,
]

/** Classify one failed test as infrastructure trouble or a product regression. */
export function classifyFailure(failure: FailureInput): FailureKind {
  const message = failure.message ?? ''
  if (!message) return 'product'
  return INFRA_PATTERNS.some((p) => p.test(message)) ? 'infra' : 'product'
}

export type FailureSummary<T extends FailureInput> = {
  infra: T[]
  product: T[]
  total: number
  /** True when there was at least one failure and every one of them was infra. */
  infraOnly: boolean
}

/** Split a run's failures into infra and product buckets. */
export function summarizeFailures<T extends FailureInput>(failures: T[]): FailureSummary<T> {
  const infra: T[] = []
  const product: T[] = []

  for (const failure of failures) {
    if (classifyFailure(failure) === 'infra') infra.push(failure)
    else product.push(failure)
  }

  return {
    infra,
    product,
    total: failures.length,
    infraOnly: failures.length > 0 && product.length === 0,
  }
}
