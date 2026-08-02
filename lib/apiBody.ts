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
const tooLarge = () => NextResponse.json({ error: 'Request body too large' }, { status: 413 })

// "Nothing but whitespace" by JSON's definition, which is only space, tab, LF
// and CR. `String.trim()` uses the much wider Unicode set, so it would call a
// body of U+00A0 or a BOM empty — and an optional route would accept that as
// `{}` and mutate, on a body JSON.parse cannot read.
const JSON_BLANK = /^[ \t\n\r]*$/

export async function readJsonBody<T = JsonBody>(
  request: Request,
  /**
   * `optional` is for the few routes whose body is genuinely optional — mark-paid
   * defaults the payment date to today when none is sent. Sending nothing and
   * sending something broken are different mistakes, and only the second is the
   * client's, so an absent body yields `{}` while a malformed one is still a 400.
   */
  {
    optional = false,
    /**
     * Upper bound, in UTF-8 bytes, on the body this route will accept. Routes
     * whose body is a couple of scalars should set one: the PDF report endpoint
     * takes only a locale but triggers an expensive server-side render, so a
     * huge payload is refused with a 413 instead of being parsed first (#594).
     * Unset means unbounded, which is the pre-existing behaviour everywhere else.
     */
    maxBytes,
  }: { optional?: boolean; maxBytes?: number } = {},
): Promise<JsonBodyResult<T>> {
  // Content-Length is the only chance to refuse before the body is in memory.
  // It is a client-supplied claim, so the decoded text is measured again below —
  // this check is an optimisation, not the limit itself.
  if (maxBytes != null) {
    const declared = Number(request.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, response: tooLarge() }
  }

  // Read as text rather than calling `.json()`, so "empty" is distinguishable
  // from "unparseable" instead of both arriving as the same SyntaxError.
  let raw: string
  try {
    raw = await request.text()
  } catch {
    return { ok: false, response: badRequest('Request body could not be read') }
  }

  // Bytes, not characters: a Vietnamese body is ~3 bytes per character, and the
  // cap is stated in bytes. `raw.length` first so the encode is skipped for the
  // overwhelmingly common small body (chars ≤ bytes, so a body under the cap in
  // characters may still be over it in bytes — hence the encode when it isn't).
  if (maxBytes != null && raw.length > maxBytes / 4) {
    if (new TextEncoder().encode(raw).length > maxBytes) return { ok: false, response: tooLarge() }
  }

  if (JSON_BLANK.test(raw)) {
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
