// Goal-detail mutation network calls shared by GoalDetailSheet (mobile) and
// DesktopGoalDetail (#467). These were byte-identical in both — the desktop
// unassign even carried a "Mirror of ..." comment. Plain async functions (no
// React state): each returns a success boolean (swallowing network errors) so
// the two surfaces keep their own confirm-UI / toast copy while the request
// logic lives once.

export async function deleteGoal(goalId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/v1/savings-goals/${goalId}`, { method: 'DELETE' })
    return res.ok
  } catch {
    return false
  }
}

// "Bỏ chờ gộp" — delete the held settlement row, restoring the original deposit.
export async function unholdTransaction(heldTxId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/v1/investment-transactions/${heldTxId}`, { method: 'DELETE' })
    return res.ok
  } catch {
    return false
  }
}

// Unassign an investment from a specific goal. A fund row aggregates every
// fund-investment of that fund UNDER THIS GOAL (PATCH each back to goal_id=null);
// a non-fund row is a single investment_transactions row (PUT assign goal_id=null).
export async function unassignInvestment(
  inv: { id: string; fund?: { fundId: string } | null },
  goalId: string,
): Promise<boolean> {
  try {
    if (inv.fund) {
      // Scope to this goal: the same fund can be split across goals, so an
      // unfiltered fund_id query would clear the OTHER goals' rows too. The route
      // filters by goal_id when supplied.
      const res = await fetch(`/api/v1/fund-investments?fund_id=${inv.fund.fundId}&goal_id=${goalId}`)
      if (!res.ok) return false
      // GET /fund-investments returns a bare array (see the route handler) — the
      // old `data.investments` read undefined, so Promise.all([]) sent no PATCH
      // yet reported success, silently no-op'ing the fund unassign (#467).
      const investments = await res.json() as Array<{ id: string }>
      const results = await Promise.all((investments ?? []).map((fi) =>
        fetch(`/api/v1/fund-investments/${fi.id}/goal`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goal_id: null }),
        })
      ))
      return results.every((r) => r.ok)
    }
    const res = await fetch(`/api/v1/investment-transactions/${inv.id}/assign`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal_id: null }),
    })
    return res.ok
  } catch {
    return false
  }
}
