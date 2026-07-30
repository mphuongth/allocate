import { deleteTransaction, type DeleteResult } from './deleteTransaction'
// Goal-detail mutation network calls shared by GoalDetailSheet (mobile) and
// DesktopGoalDetail (#467). These were byte-identical in both — the desktop
// unassign even carried a "Mirror of ..." comment. Plain async functions (no
// React state): each returns a success boolean (swallowing network errors) so
// the two surfaces keep their own confirm-UI / toast copy while the request
// logic lives once.

// Edit-goal save. Unlike the boolean helpers below, both edit forms show the
// server's error message inline, so this returns the response-body `error` (and a
// `networkError` flag for a thrown fetch). `date` is optional: the mobile form has
// no date field and omits it, so `target_date` must be left out of the body
// entirely in that case — passing it as null would clear an existing date.
export type GoalUpdateResult = { ok: boolean; error?: string; networkError?: boolean }

export async function updateGoal(
  goalId: string,
  fields: { name: string; target: number | null; date?: string | null },
): Promise<GoalUpdateResult> {
  const body: Record<string, unknown> = { goal_name: fields.name, target_amount: fields.target }
  if (fields.date !== undefined) body.target_date = fields.date
  try {
    const res = await fetch(`/api/v1/savings-goals/${goalId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      try {
        const { error } = await res.json()
        return { ok: false, error: typeof error === 'string' ? error : undefined }
      } catch {
        return { ok: false }
      }
    }
    return { ok: true }
  } catch {
    return { ok: false, networkError: true }
  }
}

export async function deleteGoal(goalId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/v1/savings-goals/${goalId}`, { method: 'DELETE' })
    return res.ok
  } catch {
    return false
  }
}

// "Bỏ chờ gộp" — delete the held settlement row, restoring the original deposit.
//
// Returns the same discriminated result as the ledger's delete so the caller can
// say why it was refused. It used to return a bare `res.ok`, which threw away
// the one thing the user needed (#550) — and a held settlement is exactly the
// row the server refuses once a merge has consumed it.
export async function unholdTransaction(heldTxId: string): Promise<DeleteResult> {
  return deleteTransaction(heldTxId)
}

// Unassign an investment from a specific goal. A fund row aggregates every
// fund-investment of that fund UNDER THIS GOAL (one scoped move back to
// Unallocated); a non-fund row is a single investment_transactions row (PUT
// assign goal_id=null).
export async function unassignInvestment(
  inv: { id: string; fund?: { fundId: string } | null },
  goalId: string,
): Promise<boolean> {
  try {
    if (inv.fund) {
      // Scoped to this goal: the same fund can be split across goals, so the move
      // must not touch the OTHER goals' rows (#467). It used to list the goal's
      // rows and PATCH each one, which could half-succeed and split the fund
      // between the goal and Unallocated — the route now moves the whole bucket
      // in a single statement (#589).
      const res = await fetch('/api/v1/fund-investments/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fund_id: inv.fund.fundId, from_goal_id: goalId, to_goal_id: null }),
      })
      return res.ok
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
