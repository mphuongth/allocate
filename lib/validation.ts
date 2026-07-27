// Input validators for API route handlers.
// Throw ValidationError on bad input so handlers can convert to HTTP 400.

export class ValidationError extends Error {
  status = 400
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const RATE_MIN = -100
const RATE_MAX = 1000

const DEFAULT_TEXT_MAX = 255
const NOTES_MAX = 2000

function coerceNumber(val: unknown): number | null {
  if (typeof val === 'number') return val
  if (typeof val === 'string' && val.trim() !== '') {
    const n = Number(val)
    return Number.isNaN(n) ? null : n
  }
  return null
}

export function validateAmount(
  val: unknown,
  field: string,
  opts: { positive?: boolean; integer?: boolean } = {}
): number {
  const n = coerceNumber(val)
  if (n === null || !Number.isFinite(n)) {
    throw new ValidationError(`${field} must be a finite number`)
  }
  if (opts.positive) {
    if (n <= 0) throw new ValidationError(`${field} must be positive`)
  } else if (n < 0) {
    throw new ValidationError(`${field} must be non-negative`)
  }
  // For columns modeled as BIGINT (e.g. dca_monthly_amount_vnd): a fractional
  // value would otherwise reach the DB and 500 instead of a clean 400.
  if (opts.integer && !Number.isInteger(n)) {
    throw new ValidationError(`${field} must be a whole number`)
  }
  if (n > Number.MAX_SAFE_INTEGER) {
    throw new ValidationError(`${field} exceeds maximum allowed value`)
  }
  return n
}

export function validateRate(val: unknown, field: string): number {
  const n = coerceNumber(val)
  if (n === null || !Number.isFinite(n)) {
    throw new ValidationError(`${field} must be a finite number`)
  }
  if (n < RATE_MIN || n > RATE_MAX) {
    throw new ValidationError(`${field} must be between ${RATE_MIN} and ${RATE_MAX}`)
  }
  return n
}

export function validateText(
  val: unknown,
  field: string,
  opts: { max?: number; min?: number } = {}
): string {
  if (typeof val !== 'string') {
    throw new ValidationError(`${field} must be a string`)
  }
  const trimmed = val.trim()
  const min = opts.min ?? 1
  const max = opts.max ?? DEFAULT_TEXT_MAX
  if (trimmed.length < min) {
    throw new ValidationError(`${field} is required`)
  }
  if (trimmed.length > max) {
    throw new ValidationError(`${field} exceeds ${max} characters`)
  }
  return trimmed
}

export function validateNotes(val: unknown): string | null {
  if (val === null || val === undefined) return null
  if (typeof val !== 'string') {
    throw new ValidationError('notes must be a string')
  }
  const trimmed = val.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length > NOTES_MAX) {
    throw new ValidationError(`notes exceeds ${NOTES_MAX} characters`)
  }
  return trimmed
}

export function validateUUID(val: unknown, field: string): string {
  if (typeof val !== 'string' || !UUID_RE.test(val)) {
    throw new ValidationError(`${field} must be a valid UUID`)
  }
  return val
}

// A bank reference code (FK to banks.code): short, uppercase alphanumeric. The
// DB foreign key is the real guard; this just rejects obvious junk before insert.
const BANK_CODE_RE = /^[A-Z0-9]{2,12}$/

export function validateBankCode(val: unknown, field: string): string {
  if (typeof val !== 'string' || !BANK_CODE_RE.test(val)) {
    throw new ValidationError(`${field} must be a valid bank code`)
  }
  return val
}

export function validateDate(val: unknown, field: string): string {
  if (typeof val !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    throw new ValidationError(`${field} must be in YYYY-MM-DD format`)
  }
  const [y, m, d] = val.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    throw new ValidationError(`${field} is not a valid calendar date`)
  }
  return val
}

// For month-precision fields (savings goal target month, fixed-expense
// effective_from / effective_to), accepts YYYY-MM with a real calendar month.
export function validateYearMonth(val: unknown, field: string): string {
  if (typeof val !== 'string' || !/^\d{4}-\d{2}$/.test(val)) {
    throw new ValidationError(`${field} must be in YYYY-MM format`)
  }
  const [, m] = val.split('-').map(Number)
  if (m < 1 || m > 12) {
    throw new ValidationError(`${field} has an invalid month`)
  }
  return val
}

// A whole integer, given as a number or a fully-integer string. Rejects
// anything parseInt would silently accept (e.g. "1abc" → 1), plus NaN, Infinity,
// fractional, and unsafe-magnitude values. Optional inclusive [min, max] bounds.
const INTEGER_RE = /^[+-]?\d+$/

export function validateInteger(
  val: unknown,
  field: string,
  opts: { min?: number; max?: number } = {}
): number {
  let n: number
  if (typeof val === 'number') {
    n = val
  } else if (typeof val === 'string' && INTEGER_RE.test(val.trim())) {
    n = Number(val.trim())
  } else {
    throw new ValidationError(`${field} must be an integer`)
  }
  if (!Number.isSafeInteger(n)) {
    throw new ValidationError(`${field} must be an integer`)
  }
  if (opts.min !== undefined && n < opts.min) {
    throw new ValidationError(`${field} must be at least ${opts.min}`)
  }
  if (opts.max !== undefined && n > opts.max) {
    throw new ValidationError(`${field} must be at most ${opts.max}`)
  }
  return n
}

// A pagination-style query param: absent (null/undefined/blank) falls back to
// `fallback`; a present value must be a positive integer (else ValidationError,
// so garbage returns 400 rather than silently defaulting). When `max` is given
// the value is clamped to it — the documented ceiling — instead of rejected.
export function validatePositiveIntParam(
  val: unknown,
  field: string,
  opts: { fallback: number; max?: number }
): number {
  if (val === null || val === undefined || (typeof val === 'string' && val.trim() === '')) {
    return opts.fallback
  }
  const n = validateInteger(val, field, { min: 1 })
  return opts.max !== undefined ? Math.min(n, opts.max) : n
}

export function validateEnum<T extends string>(
  val: unknown,
  allowed: readonly T[],
  field: string
): T {
  if (typeof val !== 'string' || !(allowed as readonly string[]).includes(val)) {
    throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}`)
  }
  return val as T
}

export interface PlanMonthFilter {
  month: number
  year: number
  ym: string       // YYYY-MM
  planDate: string // YYYY-MM-01
}

// The optional ?month=&year= filter shared by the fixed-expenses and
// recurring-savings list endpoints. Both narrow to the rows active in a plan
// month by interpolating the value into a PostgREST `.or(...)` filter STRING,
// where a comma starts a new term — so an unvalidated value can rewrite the
// expression rather than be compared against it. RLS still scopes the rows to
// one user, but the query must be built from values we've actually checked
// (#534).
//
// Returns null when neither param is supplied (the plain unfiltered list).
// Supplying only one is rejected rather than silently ignored: a caller asking
// for ?month=6 and getting every row back cannot tell that the filter was
// dropped — it looks like a filter that matched everything.
//
// The returned ym/planDate are rebuilt from the parsed integers, so nothing the
// caller typed reaches the query even when it happens to be valid. Same
// month/year bounds as the monthly-plan routes, which this deliberately mirrors.
export function validatePlanMonthFilter(
  month: unknown,
  year: unknown
): PlanMonthFilter | null {
  const supplied = (v: unknown) =>
    v !== null && v !== undefined && !(typeof v === 'string' && v.trim() === '')

  const hasMonth = supplied(month)
  const hasYear = supplied(year)
  if (!hasMonth && !hasYear) return null
  if (!hasMonth || !hasYear) {
    throw new ValidationError('month and year must be supplied together')
  }

  const m = validateInteger(month, 'month', { min: 1, max: 12 })
  const y = validateInteger(year, 'year', { min: 2000, max: 9999 })
  const ym = `${y}-${String(m).padStart(2, '0')}`
  return { month: m, year: y, ym, planDate: `${ym}-01` }
}
