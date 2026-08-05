import { describe, it, expect, vi, afterEach } from 'vitest'
import { deleteTransaction, DELETE_FAILURE_CODES } from '../deleteTransaction'

// DELETE /api/v1/investment-transactions/:id refuses for several distinct,
// user-actionable reasons — a settlement already merged, one still waiting to
// merge, another record referencing the row. None of them reached the screen:
// both call sites checked `res.ok` and dropped the body, so a refused delete
// made the button do nothing at all (#550).
//
// The route now returns a stable `code` alongside its English message. The code
// is what the UI translates — rendering the server's prose would put untranslated
// text in front of a Vietnamese user.

afterEach(() => vi.restoreAllMocks())

const res = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('deleteTransaction', () => {
  it('reports success on a 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(res(200, { message: 'Transaction deleted.' }))
    await expect(deleteTransaction('tx-1')).resolves.toEqual({ ok: true })
  })

  it('carries the refusal code through', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      res(409, { error: 'This settlement has already been merged…', code: 'settlement_consumed' }),
    )
    await expect(deleteTransaction('tx-1')).resolves.toEqual({ ok: false, code: 'settlement_consumed' })
  })

  it.each([
    ['merge_target'],
    ['settlement_pending'],
    ['referenced'],
    ['withdrawal_invariant'],
    ['not_found'],
    ['delete_failed'],
  ])('passes through the %s code unchanged', async (code) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(res(409, { error: 'x', code }))
    await expect(deleteTransaction('tx-1')).resolves.toEqual({ ok: false, code })
  })

  // A network failure is not a refusal — the server never got to decide, so
  // "already merged" would be a guess. It gets its own code so the UI can say
  // "connection problem" rather than invent a reason.
  it('distinguishes a network failure from a server refusal', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    await expect(deleteTransaction('tx-1')).resolves.toEqual({ ok: false, code: 'network' })
  })

  it('falls back to an unknown code when the body has none', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(res(500, {}))
    await expect(deleteTransaction('tx-1')).resolves.toEqual({ ok: false, code: 'unknown' })
  })

  it('survives a body that is not JSON at all', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>502 Bad Gateway</html>', { status: 502 }),
    )
    await expect(deleteTransaction('tx-1')).resolves.toEqual({ ok: false, code: 'unknown' })
  })

  // The gap that let withdrawal_invariant ship half-done: the route mapped the
  // refusal, the client did not list it, and it fell through to "couldn't delete
  // this transaction" — the generic sentence, in place of the instruction the
  // refusal exists to give. Pinning the three lists to each other catches the next
  // one at the point it is added rather than in a bug report.
  it('has a translation for every code the client accepts, in every language', async () => {
    const en = (await import('@/messages/en.json')).default.deleteTransaction as Record<string, string>
    const vi = (await import('@/messages/vi.json')).default.deleteTransaction as Record<string, string>

    for (const code of DELETE_FAILURE_CODES) {
      expect(en[code], `messages/en.json is missing deleteTransaction.${code}`).toBeTruthy()
      expect(vi[code], `messages/vi.json is missing deleteTransaction.${code}`).toBeTruthy()
    }
    // And nothing translated that the client can never produce.
    expect(Object.keys(en).sort()).toEqual([...DELETE_FAILURE_CODES].sort())
    expect(Object.keys(vi).sort()).toEqual([...DELETE_FAILURE_CODES].sort())
  })
})
