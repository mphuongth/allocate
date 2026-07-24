// Monthly-plan mutation network calls shared by MobilePlanningView and
// DesktopPlanningView (#467). Each request (set/create income, delete plan, save
// an other-expense) was duplicated near-identically across the two surfaces —
// same URL/method/body — while only the surrounding UX (inline `setError` on
// mobile vs `toast.error` on desktop, the created-plan mapping) differed.
//
// These plain async functions own just the request. They return a small result
// so each caller keeps its own validation + toast/error copy: `error` carries the
// server's response-body message (mobile shows it; desktop ignores it in favor of
// a generic toast), `networkError` marks a thrown fetch (offline), and `data`
// carries the parsed body on the create path (the new plan).
export type PlanActionResult<T = unknown> = {
  ok: boolean
  error?: string
  networkError?: boolean
  data?: T
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

// Best-effort read of a `{ error }` message from a failed response; absent/invalid
// bodies just yield `undefined` so the caller falls back to its own copy.
async function errorBody(res: Response): Promise<string | undefined> {
  try {
    const { error } = await res.json()
    return typeof error === 'string' ? error : undefined
  } catch {
    return undefined
  }
}

/** Set the month's income: create the plan (POST) when none exists yet, else
 *  update its salary (PUT — deliberately not PATCH, which the route 405s). On
 *  create, `data` is the new plan the caller hands to its `onPlanCreated`. */
export async function saveIncome(params: {
  planId?: string | null
  month: number
  year: number
  salaryVnd: number
}): Promise<PlanActionResult> {
  const { planId, month, year, salaryVnd } = params
  try {
    if (planId) {
      const res = await fetch(`/api/v1/monthly-plans/${planId}`, {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify({ salary_vnd: salaryVnd }),
      })
      if (!res.ok) return { ok: false, error: await errorBody(res) }
      return { ok: true }
    }
    const res = await fetch('/api/v1/monthly-plans', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ month, year, salary_vnd: salaryVnd }),
    })
    if (!res.ok) return { ok: false, error: await errorBody(res) }
    return { ok: true, data: await res.json() }
  } catch {
    return { ok: false, networkError: true }
  }
}

/** Delete the month's plan. The body carries no message either surface reads, so
 *  only ok / networkError are reported. */
export async function deletePlan(planId: string): Promise<PlanActionResult> {
  try {
    const res = await fetch(`/api/v1/monthly-plans/${planId}`, { method: 'DELETE' })
    return res.ok ? { ok: true } : { ok: false }
  } catch {
    return { ok: false, networkError: true }
  }
}

/** Create (POST) or edit (PUT /:id) an ad-hoc "other" expense on the plan. */
export async function saveOtherExpense(params: {
  planId: string
  id?: string | null
  description: string
  amountVnd: number
}): Promise<PlanActionResult> {
  const { planId, id, description, amountVnd } = params
  const url = id
    ? `/api/v1/monthly-plans/${planId}/other-expenses/${id}`
    : `/api/v1/monthly-plans/${planId}/other-expenses`
  try {
    const res = await fetch(url, {
      method: id ? 'PUT' : 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ description, amount_vnd: amountVnd }),
    })
    if (!res.ok) return { ok: false, error: await errorBody(res) }
    return { ok: true }
  } catch {
    return { ok: false, networkError: true }
  }
}
