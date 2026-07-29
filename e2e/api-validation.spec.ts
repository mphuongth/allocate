import { test, expect } from '@playwright/test'
import * as api from './helpers/api'

// API-level validator rejection tests. These hit the route handlers directly
// using Playwright's authenticated request context (storageState from setup).
// We don't need to test every route — one canonical bad-payload per validator
// type is enough; the validators themselves are unit-tested in
// lib/__tests__/validation.test.ts.

test.describe('API input validation', () => {
  test('POST /api/v1/savings-goals rejects amount with Infinity (400)', async ({ request }) => {
    const res = await request.post('/api/v1/savings-goals', {
      data: {
        goal_name: 'Test',
        target_amount: 'Infinity',
      },
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/v1/savings-goals rejects amount that is negative (400)', async ({ request }) => {
    const res = await request.post('/api/v1/savings-goals', {
      data: {
        goal_name: 'Test',
        target_amount: -100,
      },
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/v1/savings-goals rejects oversized goal_name (400)', async ({ request }) => {
    const res = await request.post('/api/v1/savings-goals', {
      data: {
        goal_name: 'a'.repeat(300),
      },
    })
    expect(res.status()).toBe(400)
  })

  test('GET /api/v1/savings-goals/<bad-uuid> rejects malformed UUID (400)', async ({ request }) => {
    const res = await request.get('/api/v1/savings-goals/not-a-uuid')
    expect(res.status()).toBe(400)
  })

  test('PUT /api/v1/savings-goals/<bad-uuid> rejects malformed UUID (400)', async ({ request }) => {
    const res = await request.put('/api/v1/savings-goals/not-a-uuid', {
      data: { goal_name: 'updated' },
    })
    expect(res.status()).toBe(400)
  })

  test('PATCH /api/v1/savings-goals/<bad-uuid> rejects malformed UUID (400)', async ({ request }) => {
    const res = await request.patch('/api/v1/savings-goals/not-a-uuid', {
      data: { goal_name: 'updated' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/v1/investment-transactions rejects negative interest_rate beyond -100 (400)', async ({ request }) => {
    const res = await request.post('/api/v1/investment-transactions', {
      data: {
        asset_type: 'bank',
        amount_vnd: 1000,
        investment_date: '2026-01-01',
        interest_rate: -500,
      },
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/v1/investment-transactions rejects malformed investment_date (400)', async ({ request }) => {
    const res = await request.post('/api/v1/investment-transactions', {
      data: {
        asset_type: 'bank',
        amount_vnd: 1000,
        investment_date: 'not-a-date',
      },
    })
    expect(res.status()).toBe(400)
  })

  // Only bank TERM deposits (interest rate + maturity date) can be renewed. A
  // flexible bank deposit — asset_type='bank' but no rate and no expiry — has no
  // cycle to roll forward; renewing it would mint a maturity/interest it never
  // had. The route's asset_type==='bank' check alone passed it through, so guard
  // on the term-deposit shape too. (Body is otherwise valid: the 400 is the
  // flex-deposit guard, not payload validation.)
  test('POST /api/v1/investment-transactions/<id>/renew rejects a flex bank deposit (400)', async ({ request }) => {
    const today = new Date().toISOString().slice(0, 10)
    // A flexible deposit: bank, but no interest_rate and no expiry_date.
    const flex = await api.createTransaction({
      asset_type: 'bank',
      amount_vnd: 5_000_000,
      investment_date: today,
      notes: 'E2E flex renew guard',
    })
    try {
      const res = await request.post(`/api/v1/investment-transactions/${flex.transaction_id}/renew`, {
        data: {
          amount_vnd: 5_000_000,
          interest_rate: 6,
          expiry_date: new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10),
          investment_date: today,
        },
      })
      expect(res.status()).toBe(400)
    } finally {
      await api.deleteTransaction(flex.transaction_id)
    }
  })

  // Pagination / month / DCA hardening (#471): junk inputs that used to reach
  // the DB as NaN ranges, parseInt('1abc') → 1, or CHECK-violating amounts must
  // now be a clean 400 at the route.
  test('GET /api/v1/investment-transactions rejects non-integer page (400)', async ({ request }) => {
    const res = await request.get('/api/v1/investment-transactions?page=abc')
    expect(res.status()).toBe(400)
  })

  test('GET /api/v1/investment-transactions rejects a fractional limit (400)', async ({ request }) => {
    const res = await request.get('/api/v1/investment-transactions?limit=2.5')
    expect(res.status()).toBe(400)
  })

  test('GET /api/v1/monthly-plans rejects a mixed-string month (400)', async ({ request }) => {
    const res = await request.get('/api/v1/monthly-plans?month=1abc&year=2026')
    expect(res.status()).toBe(400)
  })

  test('POST /api/v1/monthly-plans rejects a mixed-string month (400)', async ({ request }) => {
    const res = await request.post('/api/v1/monthly-plans', {
      data: { month: '1abc', year: 2026, salary_vnd: 30_000_000 },
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/funds rejects an Infinity NAV (400)', async ({ request }) => {
    const res = await request.post('/api/funds', {
      data: { name: 'E2E Inf NAV', code: 'E2EINF', fund_type: 'equity', nav: 'Infinity' },
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/funds rejects a negative DCA amount (400)', async ({ request }) => {
    const res = await request.post('/api/funds', {
      data: {
        name: 'E2E Neg DCA', code: 'E2ENEG', fund_type: 'equity', nav: 20_000,
        is_dca: true, dca_monthly_amount_vnd: -5_000_000,
      },
    })
    expect(res.status()).toBe(400)
  })

  test('POST /api/funds rejects a fractional DCA amount — BIGINT column (400)', async ({ request }) => {
    const res = await request.post('/api/funds', {
      data: {
        name: 'E2E Frac DCA', code: 'E2EFRC', fund_type: 'equity', nav: 20_000,
        is_dca: true, dca_monthly_amount_vnd: 1.5,
      },
    })
    expect(res.status()).toBe(400)
  })

  // The renewed cycle must have positive length: its new maturity has to fall
  // strictly after its start (investment) date. The client anchors the start to
  // the old maturity, so a hand-edited maturity on or before it must be rejected.
  test('POST /api/v1/investment-transactions/<id>/renew rejects a non-positive cycle length (400)', async ({ request }) => {
    const opened = '2026-03-04'
    const maturity = '2026-06-04'
    // A real bank TERM deposit: carries both an interest rate and a maturity.
    const term = await api.createTransaction({
      asset_type: 'bank',
      amount_vnd: 20_000_000,
      investment_date: opened,
      interest_rate: 5.5,
      expiry_date: maturity,
      notes: 'E2E renew date-order guard',
    })
    try {
      const res = await request.post(`/api/v1/investment-transactions/${term.transaction_id}/renew`, {
        data: {
          amount_vnd: 20_000_000,
          interest_rate: 5.5,
          // New maturity equals the investment date → zero-length cycle.
          expiry_date: maturity,
          investment_date: maturity,
        },
      })
      expect(res.status()).toBe(400)
    } finally {
      await api.deleteTransactionCascade(term.transaction_id)
    }
  })

  // A malformed body is a client mistake, not a server failure. These used to
  // throw an uncaught SyntaxError out of `await request.json()` and surface as
  // 500s (#566). One canonical endpoint is enough here — the shared helper every
  // write route now goes through is unit-tested in lib/__tests__/apiBody.test.ts.
  //
  // `Buffer`, not a string: Playwright JSON-encodes a string `data`, so the
  // route would receive a perfectly valid JSON *string* and reject it in its own
  // validators — 400 for the wrong reason, passing against the old code too.
  // A Buffer is sent as raw bytes, which is what actually reproduces the 500.
  const rawPost = (request: import('@playwright/test').APIRequestContext, raw: string) =>
    request.post('/api/v1/savings-goals', {
      headers: { 'Content-Type': 'application/json' },
      data: Buffer.from(raw),
    })

  test('POST /api/v1/savings-goals rejects a syntactically invalid body (400)', async ({ request }) => {
    const res = await rawPost(request, '{"goal_name": ')
    expect(res.status()).toBe(400)
  })

  test('POST /api/v1/savings-goals rejects an empty body (400)', async ({ request }) => {
    const res = await rawPost(request, '')
    expect(res.status()).toBe(400)
  })

  test('POST /api/v1/savings-goals rejects a body that is not a JSON object (400)', async ({ request }) => {
    const res = await rawPost(request, '"just a string"')
    expect(res.status()).toBe(400)
  })

  test('POST /api/v1/savings-goals still validates a well-formed body the same way (400)', async ({ request }) => {
    // Guards the other half of the change: valid JSON must still reach the
    // route's own validators rather than being turned away by the new parser.
    const res = await request.post('/api/v1/savings-goals', {
      data: { goal_name: '' },
    })
    expect(res.status()).toBe(400)
  })
})
