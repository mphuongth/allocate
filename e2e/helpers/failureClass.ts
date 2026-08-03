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
  // Gateway and rate-limit responses. The classifier sees the message *and* the
  // stack, so a bare number is not enough — `dashboard.spec.ts:503:11` and an
  // expected value of 429 are ordinary product failures. Require either the
  // status phrase or an explicit HTTP-status context.
  /too many requests/i,
  /service unavailable/i,
  /gateway timeout/i,
  /bad gateway/i,
  /\b(?:status(?:[ _]?code)?|http)\b\W{0,3}(?:429|50[234])\b/i,
  // The app server never came up at all. Playwright words this several ways
  // ("Timed out waiting … from config.webServer.", "Process from
  // config.webServer was not able to start."), so match the config key itself.
  /config\.webServer/i,
  // Browser / worker died under us
  /browser has been closed/i,
  /browser closed unexpectedly/i,
  /target crashed/i,
  /page crashed/i,
]

/**
 * Playwright colours its errors, so a real diff arrives as
 * `Received: <ESC>[31m503<ESC>[39m` — the escape sits between the label and the
 * number and defeats any pattern spanning the two. Strip them before matching.
 */
const ANSI = /\u001b\[[0-9;]*m/g

/**
 * Deliberately *not* a signal: an assertion diff of the form
 * `Expected: 400 / Received: 503`. When a throttled gateway answers a status the
 * test asserted on, that diff is all the reporter gets — `TestResult.errors[]`
 * carries no code snippet (verified by instrumenting a real run), so there is no
 * HTTP context to key on, and the identical text is what a money-value
 * regression prints. Such a run is reported as a *product* failure: calling a
 * genuine regression "infra" is the failure mode this classifier exists to
 * prevent, so ambiguity resolves that way. Real throttling nearly always also
 * carries one of the signals above — a socket error, a statement timeout, or
 * the status phrase itself.
 */

/** Classify one failed test as infrastructure trouble or a product regression. */
export function classifyFailure(failure: FailureInput): FailureKind {
  const message = (failure.message ?? '').replace(ANSI, '')
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
