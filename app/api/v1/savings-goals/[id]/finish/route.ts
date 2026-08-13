import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateUUID } from '@/lib/validation'
import { readJsonBody } from '@/lib/apiBody'
import { todayIso } from '@/lib/dates'
import { buildDashboardOverview } from '@/lib/dashboardOverview'

// Finish a goal (#650): liquidate every live holding and archive it at 100%.
//
// GET  → what still blocks the finish, so the sheet can name each one before the
//        user fills in a single figure.
// POST → the finish itself. One RPC does the whole liquidation and the snapshot
//        in a single transaction; this route validates the request shape, decides
//        the completion value, and translates the database's refusals.

type Blocker = { code: string; label: string }
type ServerHolding = {
  key: string; kind: string; asset_type: string | null
  principal: number | null; units: number | null; name: string | null
}

async function loadGoal(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, goalId: string, userId: string) {
  return supabase
    .from('savings_goals')
    .select('goal_id, goal_name, completed_at')
    .eq('goal_id', goalId)
    .eq('user_id', userId)
    .maybeSingle()
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let goalId: string
  try {
    goalId = validateUUID(id, 'goal_id')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: goal } = await loadGoal(supabase, goalId, user.id)
  if (!goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })

  // Both from the database, and the holdings from the very enumeration the
  // finish validates the plan against. The goal-detail page holds the newest 200
  // transactions; on a longer-lived goal the older holdings are simply not there,
  // and a plan built from that page would be refused as incomplete for good.
  const [blockersRes, holdingsRes] = await Promise.all([
    supabase.rpc('savings_goal_finish_blockers', { p_goal_id: goalId }),
    supabase.rpc('savings_goal_live_holdings', { p_goal_id: goalId }),
  ])
  if (blockersRes.error || holdingsRes.error) {
    console.error('finish precheck failed', blockersRes.error?.message ?? holdingsRes.error?.message)
    return NextResponse.json({ error: 'Failed to check the goal' }, { status: 500 })
  }

  return NextResponse.json({
    blockers: (blockersRes.data ?? []) as Blocker[],
    holdings: (holdingsRes.data ?? []) as ServerHolding[],
    completed: goal.completed_at != null,
  })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body

  let goalId: string
  let plan: Array<{ key: string; received: number }>
  try {
    goalId = validateUUID(id, 'goal_id')
    if (!Array.isArray(body.plan)) throw new ValidationError('plan must be an array')
    plan = (body.plan as unknown[]).map((raw, i) => {
      const entry = raw as { key?: unknown; received?: unknown }
      if (typeof entry?.key !== 'string' || entry.key === '') {
        throw new ValidationError(`plan[${i}].key must be a holding key`)
      }
      // Positive, not merely non-negative: a withdrawal's amount_vnd must be
      // positive, so a zero would be refused by the table and roll the whole
      // finish back behind a generic error.
      //
      // Bounded by the shared validateAmount, which caps at MAX_SAFE_INTEGER —
      // the column is a BIGINT, and 1e30 is a finite number that rounds happily
      // here and then overflows the cast inside the transaction, turning a bad
      // request into a 500.
      const received = validateAmount(entry.received, `plan[${i}].received`, { positive: true })
      if (received < 1) {
        throw new ValidationError(`plan[${i}].received must be a positive amount`)
      }
      return { key: entry.key, received: Math.round(received) }
    })
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: goal } = await loadGoal(supabase, goalId, user.id)
  if (!goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
  if (goal.completed_at) {
    return NextResponse.json(
      { error: 'This goal is already completed.', code: 'already_completed' },
      { status: 409 },
    )
  }

  // Read BEFORE the valuation below, and re-read by the RPC under the goal's
  // lock. Anything that lands in this goal's ledger from here on invalidates the
  // figure we are about to compute, and the finish refuses rather than archiving
  // a result the ledger no longer supports. Taking it first makes the check
  // over-strict rather than under-strict, which is the safe direction.
  const { data: fingerprint, error: fpError } = await supabase
    .rpc('savings_goal_ledger_fingerprint', { p_goal_id: goalId })
  if (fpError) {
    console.error('savings_goal_ledger_fingerprint failed', fpError.message)
    return NextResponse.json({ error: 'Failed to value the goal' }, { status: 500 })
  }

  // The snapshot records what the goal ACHIEVED, and that is its progress value —
  // the same number the goal card shows, which already counts contributions the
  // user has spent on the goal's purpose (affects_progress=false withdrawals).
  // Taking the realized cash instead would understate every goal that was partly
  // spent before it was finished. Computed here rather than accepted from the
  // client so the archive cannot be set to a number the ledger doesn't support.
  const overview = await buildDashboardOverview(supabase, user.id)
  if (!overview.ok) {
    return NextResponse.json({ error: 'Failed to value the goal' }, { status: 500 })
  }
  const goalValue = overview.data.goals.find((g) => g.goalId === goalId)
  const completionValue = Math.max(0, Math.round(goalValue?.progressValue ?? goalValue?.currentValue ?? 0))

  const { data, error } = await supabase.rpc('finish_savings_goal', {
    p_goal_id: goalId,
    p_plan: plan,
    p_date: todayIso(),
    p_completion_value: completionValue,
    p_ledger_fingerprint: fingerprint,
  })

  if (error) {
    const message = error.message ?? ''
    // Something still feeds this goal. Named so the sheet can point at it —
    // 'finish goal blocked: <code> <label>'.
    if (message.startsWith('finish goal blocked: ')) {
      const rest = message.slice('finish goal blocked: '.length)
      const code = rest.split(' ')[0]
      return NextResponse.json(
        { error: 'Something still feeds this goal. Stop or reassign it first.', code: `blocked_${code}`, blocker: rest },
        { status: 409 },
      )
    }
    // A stale sheet: the goal is not the goal the plan was built from. Reload and
    // try again — retrying the same plan would only fail the same way.
    if (message.startsWith('finish goal: ')) {
      return NextResponse.json(
        { error: message.slice('finish goal: '.length), code: 'stale_plan' },
        { status: 409 },
      )
    }
    if (message.startsWith('successor book: ')) {
      return NextResponse.json(
        { error: message.slice('successor book: '.length), code: 'successor_planned' },
        { status: 409 },
      )
    }
    // The ledger refused one of the withdrawals — the whole finish rolled back.
    if (message.startsWith('withdrawal invariant: ') || message.startsWith('withdraw_accumulating_book: ')) {
      return NextResponse.json(
        { error: 'A holding could not be liquidated, so nothing was changed. Reload the goal and try again.', code: 'liquidation_refused' },
        { status: 400 },
      )
    }
    console.error('finish_savings_goal failed', message)
    return NextResponse.json({ error: 'Failed to finish the goal' }, { status: 500 })
  }

  const result = (data ?? {}) as { realized?: number; holdings?: number; completion_value?: number }
  return NextResponse.json({
    realized: result.realized ?? 0,
    holdings: result.holdings ?? 0,
    completionValue: result.completion_value ?? completionValue,
    completionPercentage: 100,
  })
}
