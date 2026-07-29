// Request-body reading for API route handlers.
//
// Handlers used to call `await request.json()` bare, usually before entering the
// `try` that converts ValidationError into a 400. An invalid or empty body threw
// an uncaught SyntaxError, so a malformed client request was reported as HTTP
// 500 — noise in error monitoring, misleading retry semantics, and a validation
// contract that differed from every other bad input (#566).
//
// Returns a result rather than throwing so it works the same whether or not the
// call site already has a try/catch, and so the 400 is visible at the call site:
//
//   const parsed = await readJsonBody(request)
//   if (!parsed.ok) return parsed.response
//   const { goal_name } = parsed.body

import { NextResponse } from 'next/server'

/**
 * Field types stay as loose as `request.json()` was, so adopting this helper is
 * a behaviour-preserving change and nothing else: routes narrow their own fields
 * through lib/validation. A route that wants better than that can pass its own
 * shape — `readJsonBody<{ ym?: string }>(request)` — which is the right way to
 * tighten one route at a time.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JsonBody = Record<string, any>

export type JsonBodyResult<T> =
  | { ok: true; body: T }
  | { ok: false; response: NextResponse }

const badRequest = (error: string) => NextResponse.json({ error }, { status: 400 })

export async function readJsonBody<T = JsonBody>(
  request: Request,
  /**
   * `optional` is for the few routes whose body is genuinely optional — mark-paid
   * defaults the payment date to today when none is sent. Sending nothing and
   * sending something broken are different mistakes, and only the second is the
   * client's, so an absent body yields `{}` while a malformed one is still a 400.
   */
  { optional = false }: { optional?: boolean } = {},
): Promise<JsonBodyResult<T>> {
  // Read as text rather than calling `.json()`, so "empty" is distinguishable
  // from "unparseable" instead of both arriving as the same SyntaxError.
  let raw: string
  try {
    raw = await request.text()
  } catch {
    return { ok: false, response: badRequest('Request body could not be read') }
  }

  if (raw.trim() === '') {
    if (optional) return { ok: true, body: {} as T }
    return { ok: false, response: badRequest('Request body must be valid JSON') }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, response: badRequest('Request body must be valid JSON') }
  }

  // Handlers destructure the body immediately. `null` throws a TypeError on
  // destructuring — another 500 — and a primitive or array silently yields
  // undefined for every field, which surfaces as "missing required field"
  // rather than "wrong shape". Every write route here takes a JSON object;
  // the one batch endpoint wraps its array in `{ transactions }`.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, response: badRequest('Request body must be a JSON object') }
  }

  return { ok: true, body: parsed as T }
}
