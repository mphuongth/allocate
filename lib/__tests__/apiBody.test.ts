import { describe, it, expect } from 'vitest'
import { DEFAULT_MAX_BODY_BYTES, readJsonBody } from '../apiBody'

// Write handlers used to call `await request.json()` bare, so an invalid or
// empty body threw an uncaught SyntaxError and Next reported it as a 500 — a
// client mistake logged as a server failure, with retry semantics to match
// (#566). Real Request objects here, so the parse failure is the browser's, not
// a stand-in for it.
const post = (body: BodyInit | null) =>
  new Request('http://localhost/api/v1/savings-goals', { method: 'POST', body })

/**
 * A chunked body — no Content-Length — that counts how much of it was pulled.
 * A client that omits Content-Length is the case a "measure it afterwards" cap
 * cannot cover, so both the default limit and an explicit one are tested here.
 */
function chunked(chunkCount: number, chunkBytes = 1024) {
  const pulled = { chunks: 0 }
  const chunk = new TextEncoder().encode('x'.repeat(chunkBytes))
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled.chunks >= chunkCount) return controller.close()
      pulled.chunks++
      controller.enqueue(chunk)
    },
  })
  const request = new Request('http://localhost/api/v1/report', {
    method: 'POST',
    body: stream,
    // Required by undici to send a stream body.
    duplex: 'half',
  } as RequestInit & { duplex: 'half' })
  return { request, pulled }
}

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

  // Every write route is bounded whether or not it asked to be. The cap used to
  // be opt-in, so 33 authenticated write routes buffered the entire request
  // before validation ran — a single client could make the server hold as much
  // memory as it cared to send (#682). None of those bodies is more than a
  // handful of fields, so the default is generous by two orders of magnitude and
  // still refuses the pathological case.
  describe('the default limit', () => {
    /** A JSON object whose serialised form is exactly `bytes` UTF-8 bytes. */
    // `{"pad":"` + padding + `"}` — ten bytes of envelope, all of it ASCII.
    const bodyOfBytes = (bytes: number) => `{"pad":"${'x'.repeat(bytes - 10)}"}`

    it('accepts a body exactly at the limit', async () => {
      const result = await readJsonBody(post(bodyOfBytes(DEFAULT_MAX_BODY_BYTES)))

      expect(result.ok).toBe(true)
    })

    it('rejects a body one byte over the limit with 413', async () => {
      const result = await readJsonBody(post(bodyOfBytes(DEFAULT_MAX_BODY_BYTES + 1)))

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.response.status).toBe(413)
        expect(await result.response.json()).toEqual({ error: 'Request body too large' })
      }
    })

    // The Content-Length shortcut cannot help here, so this is the case that
    // proves the default is enforced by the streaming reader and not by a header
    // the client controls.
    it('rejects an oversized chunked body with 413', async () => {
      const { request } = chunked(512)
      expect(request.headers.get('content-length')).toBeNull()

      const result = await readJsonBody(request)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.response.status).toBe(413)
    })

    // "Before being fully buffered" is the whole point: a 16 MiB chunked upload
    // must cost the server the cap plus one chunk, not 16 MiB.
    it('stops reading an oversized chunked body instead of buffering it', async () => {
      const oneMiB = 1024 * 1024
      const { request, pulled } = chunked(16, oneMiB)

      await readJsonBody(request)

      // 256 KiB cap, 1 MiB chunks: the first chunk already blows the cap, so the
      // remaining 15 MiB are never pulled.
      expect(pulled.chunks).toBe(1)
    })

    it('leaves an explicit larger cap in charge', async () => {
      const result = await readJsonBody(post(bodyOfBytes(DEFAULT_MAX_BODY_BYTES + 1)), {
        maxBytes: DEFAULT_MAX_BODY_BYTES * 4,
      })

      expect(result.ok).toBe(true)
    })

    it('leaves an explicit stricter cap in charge', async () => {
      const result = await readJsonBody(post(bodyOfBytes(1024)), { maxBytes: 256 })

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.response.status).toBe(413)
    })
  })

  // A route whose body is a handful of scalars has no reason to accept even the
  // default. The PDF report endpoint sets a very small cap because the work it
  // triggers is expensive and its body carries nothing but a locale (#594) — an
  // oversized payload is refused before it is parsed.
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

    // A client that omits Content-Length (chunked transfer encoding) would
    // otherwise have the whole body buffered and decoded before the cap was
    // consulted — the DoS the cap exists to prevent, just one step later. The
    // body is read incrementally and the read is abandoned the moment the
    // running total passes the cap.
    describe('streaming', () => {
      it('rejects an oversized chunked body with 413', async () => {
        const { request } = chunked(64)
        expect(request.headers.get('content-length')).toBeNull()

        const result = await readJsonBody(request, { maxBytes: 256 })
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.response.status).toBe(413)
      })

      it('stops reading instead of buffering the whole body', async () => {
        const { request, pulled } = chunked(1024)

        await readJsonBody(request, { maxBytes: 256 })

        // One chunk already exceeds the cap, so the read ends there rather than
        // pulling the remaining megabyte into memory.
        expect(pulled.chunks).toBe(1)
      })

      it('still parses a chunked body within the cap', async () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"loc'))
            controller.enqueue(new TextEncoder().encode('ale":"vi"}'))
            controller.close()
          },
        })
        const request = new Request('http://localhost/api/v1/report', {
          method: 'POST', body: stream, duplex: 'half',
        } as RequestInit & { duplex: 'half' })

        expect(await readJsonBody(request, { maxBytes: 256 })).toEqual({ ok: true, body: { locale: 'vi' } })
      })

      // A multi-byte character split across two chunks must not decode to two
      // replacement characters — the decode is incremental, not per chunk.
      it('decodes a multi-byte character split across chunks', async () => {
        const encoded = new TextEncoder().encode('{"note":"đ"}')
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoded.slice(0, 10))
            controller.enqueue(encoded.slice(10))
            controller.close()
          },
        })
        const request = new Request('http://localhost/api/v1/report', {
          method: 'POST', body: stream, duplex: 'half',
        } as RequestInit & { duplex: 'half' })

        expect(await readJsonBody(request, { maxBytes: 256 })).toEqual({ ok: true, body: { note: 'đ' } })
      })
    })

    it('combines with optional bodies', async () => {
      expect(await readJsonBody(post(null), { optional: true, maxBytes: 256 }))
        .toEqual({ ok: true, body: {} })
    })
  })
})
