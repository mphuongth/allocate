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

export function validateAmount(val: unknown, field: string): number {
  const n = coerceNumber(val)
  if (n === null || !Number.isFinite(n)) {
    throw new ValidationError(`${field} must be a finite number`)
  }
  if (n < 0) {
    throw new ValidationError(`${field} must be non-negative`)
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
