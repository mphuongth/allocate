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
  it('rejects JSON that is not an object', async () => {
    for (const body of ['null', '5', '"text"', 'true', '[{"goal_name":"House"}]']) {
      const { status, payload } = await reject(body)
      expect(status, body).toBe(400)
      expect(payload, body).toEqual({ error: 'Request body must be a JSON object' })
    }
  })
})
