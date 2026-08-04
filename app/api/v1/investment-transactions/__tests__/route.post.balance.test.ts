import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// The remaining-balance invariant lives in the database — one trigger for every
// writer, measuring under a lock so two concurrent sells can't both pass (#587,
// supabase/migrations/20260730000002). This file covers the route's half of that
// contract: a refusal has to reach the user as a 400 that says what happened, not
// the generic 500 every insert failure used to collapse into.
//
// Same shape as the book withdrawal already does (withdraw-book maps 'more than
// the book balance' to 'Withdrawal exceeds the book balance.'), so the two sell
// paths answer alike.

const h = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  ref: { data: { transaction_id: 'src-1', deposit_group_id: null } as unknown, error: null as unknown },
  insertResult: { data: null as unknown, error: null as unknown },
}))

vi.mock('@/lib/supabase-server', () => {
  const chain = (table: string) => {
    let op = 'select'
    const c: Record<string, unknown> = {
      select: () => c,
      insert: () => { op = 'insert'; return c },
      update: () => { op = 'update'; return c },
      eq: () => c, is: () => c, not: () => c,
      single: async () => (op === 'insert' ? h.insertResult : h.ref),
      maybeSingle: async () => (op === 'insert' ? h.insertResult : h.ref),
      then: (resolve: (v: unknown) => void) => resolve({ data: null, error: null }),
    }
    void table
    return c
  }
  return {
    createSupabaseServerClient: async () => ({
      auth: { getUser: async () => ({ data: { user: h.user } }) },
      from: (table: string) => chain(table),
    }),
  }
})

const { POST } = await import('../route')

const SOURCE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const SELL = {
  transaction_type: 'withdrawal',
  asset_type: 'bank',
  investment_date: '2026-07-01',
  amount_vnd: 50_000_000,
  parent_transaction_id: SOURCE,
  principal_withdrawn: 50_000_000,
}

const TOP_UP = {
  transaction_type: 'investment',
  asset_type: 'bank',
  investment_date: '2026-07-31',
  amount_vnd: 1_000_000,
  tops_up_deposit_id: SOURCE,
}

const call = (body: Record<string, unknown> = SELL) =>
  POST(new NextRequest('https://app.test/api/v1/investment-transactions', {
    method: 'POST',
    body: JSON.stringify(body),
  }))

// What the trigger raises; supabase-js surfaces the SQLSTATE as `code`.
const balanceRefusal = (message: string) => ({
  data: null,
  error: { code: '23514', message },
})

describe('POST /api/v1/investment-transactions — remaining balance', () => {
  beforeEach(() => {
    h.user = { id: 'user-1' }
    h.ref = { data: { transaction_id: SOURCE, deposit_group_id: null }, error: null }
    h.insertResult = { data: { transaction_id: 'new-1' }, error: null }
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  it('creates the withdrawal when the holding covers it', async () => {
    const res = await call()
    expect(res.status).toBe(201)
  })

  it('answers 400 with the reason when the principal exceeds the balance', async () => {
    h.insertResult = balanceRefusal(
      'withdrawal invariant: 50000000 exceeds the remaining balance of 40000000 on this holding')

    const res = await call()

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'Withdrawal exceeds the remaining balance of this holding.' })
  })

  it('answers 400 for a unit overdraw too', async () => {
    h.insertResult = balanceRefusal(
      'withdrawal invariant: 5 units exceeds the remaining balance of 4 units on this holding')

    const res = await call({ ...SELL, asset_type: 'gold', units_withdrawn: 5 })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/remaining balance/i) })
  })

  // A stale tab and a lost race look identical from here: the balance moved after
  // the sheet read it. Telling the user the balance is gone is the useful answer,
  // and it must not be a 500 — nothing failed.
  it('does not report a balance refusal as a server error', async () => {
    h.insertResult = balanceRefusal(
      'withdrawal invariant: 1 exceeds the remaining balance of 0 on this holding')

    const res = await call()

    expect(res.status).not.toBe(500)
  })

  // The trigger's other refusal, mapped by the route. The request shape here is a
  // well-formed one — a sourceless withdrawal is now refused before the insert
  // (see below), so this covers the mapping of a refusal raised by another writer's
  // shape rather than trying to provoke it from the API.
  it('answers 400 when the database says the row draws on no holding', async () => {
    h.insertResult = balanceRefusal(
      'withdrawal invariant: draws on no holding — it has neither a parent transaction nor a fund')

    const res = await call()

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'This withdrawal does not match the holding it is drawn on.' })
  })

  it('still reports an unrelated insert failure as a 500', async () => {
    h.insertResult = { data: null, error: { code: '08006', message: 'connection failure' } }

    const res = await call()

    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ error: 'Failed to create transaction' })
  })

  // ── the shape rules, refused before the insert ─────────────────────────────
  // The trigger states the same rules, but a request that omits the very number to
  // be measured deserves a message naming the field. See the decision table.
  it('refuses a parent-backed withdrawal that records no principal', async () => {
    for (const body of [
      { ...SELL, principal_withdrawn: undefined },
      { ...SELL, principal_withdrawn: 0 },
    ]) {
      const res = await call(body)
      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/principal_withdrawn is required/) })
    }
  })

  it('refuses a gold sale with no units', async () => {
    h.ref = { data: { transaction_id: SOURCE, deposit_group_id: null, asset_type: 'gold' }, error: null }

    const res = await call({ ...SELL, asset_type: 'gold' })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/units_withdrawn is required/) })
  })

  it('accepts a gold sale that moves both', async () => {
    h.ref = { data: { transaction_id: SOURCE, deposit_group_id: null, asset_type: 'gold' }, error: null }

    const res = await call({ ...SELL, asset_type: 'gold', units_withdrawn: 5 })

    expect(res.status).toBe(201)
  })

  it('refuses a fund sale with no units', async () => {
    const res = await call({
      transaction_type: 'withdrawal', asset_type: 'fund',
      fund_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      investment_date: '2026-07-01', amount_vnd: 1_000_000, principal_withdrawn: 1_000_000,
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/units_withdrawn is required/) })
  })

  // A bank withdrawal has no units to move — requiring them would break every
  // ordinary deposit withdrawal.
  it('does not ask a bank withdrawal for units', async () => {
    const res = await call()
    expect(res.status).toBe(201)
  })

  // A withdrawal that names no holding is cash leaving nowhere, whatever its
  // amount says.
  it('refuses a withdrawal that says nothing about what it draws on', async () => {
    const res = await call({
      transaction_type: 'withdrawal', asset_type: 'bank',
      investment_date: '2026-07-01', amount_vnd: 50_000_000,
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/must say what it draws on/) })
  })

  // This case used to assert a 201: held_for_merge was the one flag that
  // exempted a withdrawal from naming a source, because the pool shape had no
  // source to name yet. That exemption WAS the #588 hole — the row's amount_vnd
  // becomes net worth, so an unbacked one inflated total assets by whatever
  // number the caller sent. Held settlements are source-backed now, and there is
  // no shape left that may omit what it draws on.
  it('no longer lets held_for_merge excuse a settlement with no source', async () => {
    const res = await call({
      transaction_type: 'withdrawal', asset_type: 'bank',
      investment_date: '2026-07-01', amount_vnd: 50_000_000,
      held_for_merge: true, merge_target_goal_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    })

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringMatching(/must name the deposit it closes/),
    })
  })

  // A different check_violation (an ownership trigger, say) is not this
  // invariant's and must keep its own answer rather than borrowing this message.
  it('does not claim a balance problem for other constraint failures', async () => {
    h.insertResult = balanceRefusal('parent_transaction_id does not belong to the row owner')

    const res = await call()

    expect(res.status).toBe(500)
  })

  // The reason the match is one PREFIX and not a list of phrases: every refusal
  // the invariant adds is a bad request, and the route shouldn't have to be
  // updated (and remembered) each time one is added. Half a fund sell is the case
  // that was falling through as a 500.
  it('answers 400 for any refusal the invariant raises, including ones added later', async () => {
    for (const message of [
      'withdrawal invariant: a fund sell must record both units_withdrawn and principal_withdrawn (got 50 units, <NULL> principal)',
      'withdrawal invariant: amounts cannot be negative (principal -100, units <NULL>)',
      'withdrawal invariant: cannot be detached from fund abc, which still exists',
      'withdrawal invariant: something nobody has written yet',
    ]) {
      h.insertResult = balanceRefusal(message)
      expect((await call()).status).toBe(400)
    }
  })

  describe('accumulating-deposit top-up lock', () => {
    beforeEach(() => {
      h.ref = {
        data: {
          transaction_id: SOURCE,
          asset_type: 'bank',
          deposit_group_id: SOURCE,
          goal_id: null,
          expiry_date: '2026-08-30',
          bank_code: 'PVCOMBANK',
          top_up_lock_days: 30,
        },
        error: null,
      }
    })

    it('refuses a top-up at the inclusive lock-window boundary', async () => {
      const res = await call(TOP_UP)

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toMatchObject({
        code: 'top_up_locked_near_maturity',
        error: expect.stringMatching(/30 days remain/),
      })
    })

    it('refuses a top-up on the maturity date', async () => {
      h.ref = {
        data: {
          ...(h.ref.data as Record<string, unknown>),
          expiry_date: '2026-07-31',
        },
        error: null,
      }

      const res = await call(TOP_UP)

      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toEqual({
        error: 'Cannot top up a deposit on or after its maturity date.',
      })
    })

    it('allows a top-up immediately before the lock window', async () => {
      h.ref = {
        data: {
          ...(h.ref.data as Record<string, unknown>),
          expiry_date: '2026-08-31',
        },
        error: null,
      }

      expect((await call(TOP_UP)).status).toBe(201)
    })
  })
})
