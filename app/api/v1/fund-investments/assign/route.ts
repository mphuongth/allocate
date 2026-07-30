import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateUUID } from '@/lib/validation'
import { readJsonBody } from '@/lib/apiBody'

// Move every fund-investment of one fund from one goal bucket to another.
//
// A fund row on the dashboard aggregates all of that fund's transactions, so
// assigning or unassigning the row means moving the whole set. Both clients used
// to do that themselves — list the fund, then PATCH each id in a Promise.all
// (#589). That was wrong twice over:
//
//   1. The assign path listed the fund WITHOUT a goal filter, so assigning the
//      Unallocated row also moved rows already sitting in another goal.
//   2. Either path could half-succeed. The list shows one row per fund, so a
//      fund split between two goals is a state the user cannot see or repair.
//
// One UPDATE statement fixes both: Postgres runs it in its own transaction, so
// it is all-or-nothing, and the WHERE clause carries the source scope the client
// could only approximate. Under concurrency the statement re-checks its qual
// after taking each row lock, so rows a competing assign/unassign already moved
// out of the source bucket are skipped rather than dragged along.
//
// The buckets are addressed by goal id, with null meaning Unallocated:
//   assign   from_goal_id: null    → to_goal_id: goal
//   unassign from_goal_id: goal    → to_goal_id: null
//   move     from_goal_id: goalA   → to_goal_id: goalB
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const { fund_id, from_goal_id, to_goal_id } = parsed.body

  let cleanFundId: string
  let fromGoalId: string | null = null
  let toGoalId: string | null = null
  try {
    if (!fund_id) throw new ValidationError('Fund is required')
    cleanFundId = validateUUID(fund_id, 'fund_id')
    if (from_goal_id !== null && from_goal_id !== undefined && from_goal_id !== '') {
      fromGoalId = validateUUID(from_goal_id, 'from_goal_id')
    }
    if (to_goal_id !== null && to_goal_id !== undefined && to_goal_id !== '') {
      toGoalId = validateUUID(to_goal_id, 'to_goal_id')
    }
    if (fromGoalId === toGoalId) {
      throw new ValidationError('from_goal_id and to_goal_id must be different')
    }
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  // RLS already confines the update to the caller's rows, but a target goal that
  // isn't theirs has to be refused explicitly — the UPDATE would otherwise write
  // a foreign goal id and report a successful move.
  if (toGoalId) {
    const { data: goal } = await supabase
      .from('savings_goals')
      .select('goal_id')
      .eq('goal_id', toGoalId)
      .eq('user_id', user.id)
      .single()
    if (!goal) return NextResponse.json({ error: "You don't have permission to access this goal." }, { status: 403 })
  }

  let query = supabase
    .from('investment_transactions')
    .update({ goal_id: toGoalId, updated_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('fund_id', cleanFundId)
    .eq('asset_type', 'fund')
    // Pending DCA seeds (seeded with no units yet) are plan placeholders, not
    // holdings: GET /fund-investments hides them and the dashboard never values
    // them, so the old client path never moved them either. Same filter keeps
    // planning's rows out of an assign.
    .or('is_dca_seeded.eq.false,units.not.is.null')

  query = fromGoalId === null
    ? query.is('goal_id', null)
    : query.eq('goal_id', fromGoalId)

  const { data, error } = await query.select('transaction_id')

  if (error) {
    console.error('fund assign: update failed', error.message)
    return NextResponse.json({ error: 'Failed to assign fund' }, { status: 500 })
  }

  const moved = data?.length ?? 0
  if (moved === 0) {
    // The caller acted on a row it could see, so rows were expected. Zero means
    // something else moved them first (another tab, or a stale dashboard) — the
    // user needs to hear that, not a success flash for a move that didn't happen.
    return NextResponse.json({
      error: 'This fund has already been moved. Refresh and try again.',
      code: 'no_rows_moved',
    }, { status: 409 })
  }

  return NextResponse.json({ moved, transaction_ids: data!.map((r) => r.transaction_id) })
}
