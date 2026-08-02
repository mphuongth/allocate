import { describe, it, expect } from 'vitest'
import { readJsonBody } from '../apiBody'

// Write handlers used to call `await request.json()` bare, so an invalid or
// empty body threw an uncaught SyntaxError and Next reported it as a 500 — a
// client mistake logged as a server failure, with retry semantics to match
// (#566). Real Request objects here, so the parse failure is the browser's, not
// a stand-in for it.
const post = (body: BodyInit | null) =>
  new Request('http://localhost/api/v1/savings-goals', { method: 'POST', body })

async function reject(body: BodyInit | null) {
  const result = await readJsonBody(post(body))
  if (result.ok) throw new Error('expected the body to be rejected')
  return { status: result.response.status, payload: await result.response.json() }
}

describe('readJsonBody', () => {
  it('returns the parsed object for a valid body', async () => {
    const result = await readJsonBody(post(JSON.stringify({ goal_name: 'House', target_amount: 100 })))

    expect(result).toEqual({ ok: true, body: { goal_name: 'House', target_amount: 100 } })
  })

  it('accepts an empty object', async () => {
    const result = await readJsonBody(post('{}'))

    expect(result).toEqual({ ok: true, body: {} })
  })

  it('rejects a syntactically invalid body with 400', async () => {
    expect(await reject('{"goal_name": ')).toEqual({
      status: 400,
      payload: { error: 'Request body must be valid JSON' },
    })
  })

  it('rejects an empty body with 400', async () => {
    expect((await reject('')).status).toBe(400)
  })

  it('rejects a body that is not sent at all with 400', async () => {
    expect((await reject(null)).status).toBe(400)
  })

  it('rejects non-JSON content with 400', async () => {
    expect((await reject('goal_name=House')).status).toBe(400)
  })

  // Handlers destructure the body straight away. `null` throws a TypeError on
  // destructuring (another 500), and a primitive or array silently yields
  // undefined for every field, which reads as "missing required field" rather
  // than "you sent the wrong shape".
  // A few routes take an optional body — mark-paid defaults the payment date to
  // today when none is sent. "Nothing sent" and "sent something broken" are
  // different mistakes, and only the second is the client's.
  describe('optional bodies', () => {
    const read = (body: BodyInit | null) => readJsonBody(post(body), { optional: true })

    it('treats an absent body as an empty object', async () => {
      expect(await read(null)).toEqual({ ok: true, body: {} })
    })

    it('treats an empty body as an empty object', async () => {
      expect(await read('')).toEqual({ ok: true, body: {} })
      expect(await read('   ')).toEqual({ ok: true, body: {} })
    })

    it('still rejects a malformed body with 400', async () => {
      const result = await read('{"paid_date": ')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.response.status).toBe(400)
    })

    it('counts only JSON whitespace as empty', async () => {
      expect(await read(' \t\r\n ')).toEqual({ ok: true, body: {} })
    })

    // `String.trim()` strips Unicode whitespace, but JSON allows only space,
    // tab, CR and LF — so a body of U+00A0 would look empty here while
    // JSON.parse rejects it, and mark-paid would run the mutation on a body it
    // could not read. A BOM is deliberately absent from this list: `text()`
    // strips it while decoding, so such a body really is empty by then.
    it('rejects Unicode whitespace that JSON does not accept', async () => {
      for (const raw of ['\u00A0', '\u2028', '\u000B']) {
        const result = await read(raw)
        expect(result.ok, JSON.stringify(raw)).toBe(false)
        if (!result.ok) expect(result.response.status).toBe(400)
      }
    })

    it('still rejects JSON that is not an object', async () => {
      const result = await read('"2026-01-01"')
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.response.status).toBe(400)
    })
  })

  it('rejects JSON that is not an object', async () => {
    for (const body of ['null', '5', '"text"', 'true', '[{"goal_name":"House"}]']) {
      const { status, payload } = await reject(body)
      expect(status, body).toBe(400)
      expect(payload, body).toEqual({ error: 'Request body must be a JSON object' })
    }
  })

  // A route whose body is a handful of scalars has no reason to accept a
  // megabyte of JSON. The PDF report endpoint sets a very small cap because the
  // work it triggers is expensive and its body carries nothing but a locale
  // (#594) — an oversized payload is refused before it is parsed.
  describe('maxBytes', () => {
    const read = (body: BodyInit | null, maxBytes: number) =>
      readJsonBody(post(body), { maxBytes })

    it('accepts a body within the cap', async () => {
      expect(await read('{"locale":"vi"}', 256)).toEqual({ ok: true, body: { locale: 'vi' } })
    })

    it('rejects an oversized body with 413', async () => {
      const result = await read(JSON.stringify({ pad: 'x'.repeat(500) }), 256)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.response.status).toBe(413)
        expect(await result.response.json()).toEqual({ error: 'Request body too large' })
      }
    })

    // Content-Length is the only chance to refuse a huge body BEFORE reading it
    // into memory, so a lying-small header must not become a way past the cap:
    // the decoded text is measured too.
    it('rejects an oversized body whose Content-Length is missing or understated', async () => {
      const oversized = JSON.stringify({ pad: 'x'.repeat(500) })
      const request = new Request('http://localhost/api/v1/report', {
        method: 'POST',
        body: oversized,
        headers: { 'Content-Length': '12' },
      })
      const result = await readJsonBody(request, { maxBytes: 256 })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.response.status).toBe(413)
    })

    // Byte length, not character count: 100 Vietnamese characters are ~300 UTF-8
    // bytes, and the cap is expressed in bytes.
    it('measures bytes rather than characters', async () => {
      const result = await read(JSON.stringify({ note: 'đ'.repeat(200) }), 256)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.response.status).toBe(413)
    })

    it('combines with optional bodies', async () => {
      expect(await readJsonBody(post(null), { optional: true, maxBytes: 256 }))
        .toEqual({ ok: true, body: {} })
    })
  })
})
