// The single assign-to-goal mutation, shared by every surface that offers it:
// the desktop inline flow in UnallocatedSection and both AssignGoalSheet
// callbacks (fund and non-fund). Each used to carry its own copy, so a fix to
// error handling or atomicity could land on one and miss the others (#571).
//
// Callers keep their own UI concerns — success flashes, closing, and refresh
// sequencing (see #567) — and only await this.
//
// The fund direction shares its endpoint with `unassignInvestment` in
// goalActions.ts — same scoped move, opposite direction (#589).

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
  // Every fund assign starts from the Unallocated section, so the source bucket
  // is Unallocated — `from_goal_id: null`. This used to list the fund and PATCH
  // each row, which moved other goals' rows too and could half-succeed (#589);
  // the route now does the whole move as one scoped statement.
  const res = await fetch('/api/v1/fund-investments/assign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fund_id: fundId, from_goal_id: null, to_goal_id: goalId }),
  })
  if (res.ok) return

  const { error } = await res.json().catch(() => ({ error: null })) as { error?: string | null }
  throw new Error(error ?? 'Failed to assign')
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
