import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateUUID } from '@/lib/validation'
import { readJsonBody } from '@/lib/apiBody'
import { archivedGoalError } from '@/lib/assertOwned'

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
// One statement fixes both: Postgres runs it in its own transaction, so it is
// all-or-nothing, and its WHERE clause carries the source scope the client could
// only approximate.
//
// That statement now lives in assign_fund_bucket (#610) rather than here. It has
// to: the move must take the row locks a concurrent SELL of the same bucket takes,
// and a lock is held for the length of a transaction — so the lock and the move
// belong to one call, not to two round trips from this route. Without it the sell
// and the assign did not wait for each other, and the assign lost: a sale that
// committed after the UPDATE's snapshot stayed behind while its purchases moved
// away, splitting the bucket across two goals (#587 refuses that split, which made
// a legitimate assign fail instead of wait). See the migration for why those locks
// and not an advisory one.
//
// The buckets are addressed by goal id, with null meaning Unallocated:
//   assign   from_goal_id: null    → to_goal_id: goal
//   unassign from_goal_id: goal    → to_goal_id: null
//   move     from_goal_id: goalA   → to_goal_id: goalB

// Contention, not failure: two writers reached the same bucket and Postgres broke
// the tie by aborting one of them. Nothing is wrong with the request and nothing
// was written, so the answer is "try again" — a 500 reads as a bug and gives the
// client no reason to retry. supabase-js surfaces the SQLSTATE as error.code, so
// this is a discriminated map rather than a match on the message text.
//   40P01 deadlock_detected      — an edit of a row in the bucket crossed the move
//   55P03 lock_not_available     — a NOWAIT/timeout writer got there first
//   40001 serialization_failure  — check_fund_bucket_solvent's own retry signal
const RETRYABLE_SQLSTATES = new Set(['40P01', '55P03', '40001'])

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
    // A finished goal is an archive — a fund bucket is not moved into one (#650).
    const doneErr = await archivedGoalError(supabase, toGoalId, user.id)
    if (doneErr) return doneErr
  }

  // The source scope, the fund, the caller's own rows, and the exclusion of
  // pending DCA seeds all live in the function now — see the migration. Passing
  // null as the source is the Unallocated bucket, matched with IS NOT DISTINCT
  // FROM there rather than with an IS NULL filter built here.
  const { data, error } = await supabase.rpc('assign_fund_bucket', {
    p_fund_id: cleanFundId,
    p_from_goal_id: fromGoalId,
    p_to_goal_id: toGoalId,
  })

  if (error) {
    if (RETRYABLE_SQLSTATES.has(error.code ?? '')) {
      console.warn('fund assign: bucket contended', error.code)
      return NextResponse.json({
        error: 'This fund was being changed at the same time. Try again.',
        code: 'bucket_busy',
      }, { status: 409 })
    }
    console.error('fund assign: update failed', error.message)
    return NextResponse.json({ error: 'Failed to assign fund' }, { status: 500 })
  }

  const movedIds = (data ?? []) as string[]
  const moved = movedIds.length
  if (moved === 0) {
    // The caller acted on a row it could see, so rows were expected. Zero means
    // something else moved them first (another tab, or a stale dashboard) — the
    // user needs to hear that, not a success flash for a move that didn't happen.
    return NextResponse.json({
      error: 'This fund has already been moved. Refresh and try again.',
      code: 'no_rows_moved',
    }, { status: 409 })
  }

  return NextResponse.json({ moved, transaction_ids: movedIds })
}
