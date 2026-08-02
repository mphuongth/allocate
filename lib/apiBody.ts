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

type ReadResult = { ok: true; text: string } | { ok: false }

const readAll = async (request: Request): Promise<ReadResult> =>
  ({ ok: true, text: await request.text() })

/**
 * Read the body as text, abandoning it the moment more than `maxBytes` have
 * arrived. Buffering first and measuring afterwards would leave the DoS this cap
 * exists to prevent intact for any client that omits Content-Length — chunked
 * transfer encoding declares no size, so `request.text()` would decode the whole
 * thing before anyone asked how big it was.
 *
 * Memory is therefore bounded by the cap plus one chunk, whatever the client
 * claims or sends.
 */
async function readBounded(request: Request, maxBytes: number): Promise<ReadResult> {
  // A request sent without a body has no stream to read; `text()` yields ''.
  if (!request.body) return readAll(request)

  const reader = request.body.getReader()
  // Streaming decode: a multi-byte character split across two chunks is held
  // over rather than turning into replacement characters.
  const decoder = new TextDecoder()
  let text = ''
  let total = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return { ok: false }
    }
    text += decoder.decode(value, { stream: true })
  }

  return { ok: true, text: text + decoder.decode() }
}

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
  // Content-Length lets an oversized body be refused before a single chunk is
  // read. It is a client-supplied claim, so it is a shortcut, not the limit —
  // the streaming read below enforces the cap on what actually arrives.
  if (maxBytes != null) {
    const declared = Number(request.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, response: tooLarge() }
  }

  // Read as text rather than calling `.json()`, so "empty" is distinguishable
  // from "unparseable" instead of both arriving as the same SyntaxError.
  let raw: string
  try {
    const read = maxBytes == null ? await readAll(request) : await readBounded(request, maxBytes)
    if (!read.ok) return { ok: false, response: tooLarge() }
    raw = read.text
  } catch {
    return { ok: false, response: badRequest('Request body could not be read') }
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
