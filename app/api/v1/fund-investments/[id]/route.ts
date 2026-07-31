import { NextResponse } from 'next/server'

// Removed legacy mutations (#586).
//
// This route once exposed PUT and DELETE that wrote straight to
// investment_transactions, matched on transaction_id + user_id and nothing else.
// Both bypassed invariants the canonical /api/v1/investment-transactions/[id]
// route enforces:
//
//   • PUT had no `asset_type = 'fund'` filter, so a fund-shaped body could
//     rewrite a bank deposit's amount/units/unit_price, and it wrote a single
//     row with no accumulating-book cascade — editing one tranche split the
//     book away from its group (goal and maturity are book-level).
//   • DELETE had no `consumed_by_inv_id IS NULL` guard, so the withdrawal that
//     closes a merged source could be deleted. That re-opens the source at full
//     value while its cash still sits in the anchor: the same money counted
//     twice in net worth.
//
// Nothing in the app called either — the fund flows go through
// POST /fund-investments/assign and the canonical transaction route — so rather
// than duplicate the guards in a second place they are gone.
//
// 410 rather than dropping the handlers: an unexported method answers 405, which
// reads as "wrong verb, try another one" and invites a retry. 410 says the path
// itself is permanently gone, and it is a response a stale client can be tested
// against. Neither handler authenticates or opens a database client — a removed
// mutation must not be able to reach a row by any path through this file.

const GONE = {
  error: 'This endpoint has been removed. Use /api/v1/investment-transactions/[id] instead.',
  code: 'gone',
} as const

export async function PUT() {
  return NextResponse.json(GONE, { status: 410 })
}

export async function DELETE() {
  return NextResponse.json(GONE, { status: 410 })
}
