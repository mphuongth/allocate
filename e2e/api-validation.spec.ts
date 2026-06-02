import { test, expect } from '@playwright/test'

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
})
