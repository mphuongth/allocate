// The single assign-to-goal mutation, shared by every surface that offers it:
// the desktop inline flow in UnallocatedSection and both AssignGoalSheet
// callbacks (fund and non-fund). Each used to carry its own copy, so a fix to
// error handling or atomicity could land on one and miss the others (#571).
//
// Callers keep their own UI concerns — success flashes, closing, and refresh
// sequencing (see #567) — and only await this.
//
// Deliberately *not* shared with `unassignInvestment` in goalActions.ts: that
// scopes its fund query by goal_id, because the same fund can be split across
// goals and an unfiltered query would clear the other goals' rows too (#467).
// Same-looking requests, different operation.

export type AssignKind = 'fund' | 'nonFund'

/**
 * @param kind  'fund' aggregates every fund-investment of the fund; 'nonFund' is
 *              a single investment_transactions row (the route cascades a book).
 * @param id    fund id, or transaction id
 * @throws Error carrying a message suitable for display
 */
export async function assignInvestmentToGoal(
  kind: AssignKind,
  id: string,
  goalId: string,
): Promise<void> {
  if (kind === 'fund') return assignFund(id, goalId)
  return assignNonFund(id, goalId)
}

async function assignFund(fundId: string, goalId: string): Promise<void> {
  // A dashboard fund row aggregates every investment in that fund, so assigning
  // the row means moving all of them.
  const res = await fetch(`/api/v1/fund-investments?fund_id=${fundId}`)
  if (!res.ok) throw new Error('Failed to fetch fund investments')
  const investments = await res.json() as Array<{ id: string }>

  // Issued together rather than in sequence: they are independent, and the user
  // is waiting on a success flash. A partial move still throws — the list shows
  // one row per fund, so a half-moved fund is a state the user can't see.
  await Promise.all(investments.map((inv) =>
    fetch(`/api/v1/fund-investments/${inv.id}/goal`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal_id: goalId }),
    }).then((r) => { if (!r.ok) throw new Error('Failed to assign') })
  ))
}

async function assignNonFund(transactionId: string, goalId: string): Promise<void> {
  const res = await fetch(`/api/v1/investment-transactions/${transactionId}/assign`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal_id: goalId }),
  })
  if (res.ok) return

  // The route explains why it refused — a book held for merge, for instance —
  // and that text is the only explanation the user gets.
  const { error } = await res.json().catch(() => ({ error: null })) as { error?: string | null }
  throw new Error(error ?? 'Failed to assign')
}
