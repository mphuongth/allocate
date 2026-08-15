import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateUUID } from '@/lib/validation'
import { readJsonBody } from '@/lib/apiBody'
import { completedGoalError } from '@/lib/assertOwned'

// Re-bucket ONE fund transaction. The bulk move the dashboard uses is
// POST /fund-investments/assign (#589); this stays as a compatibility path for
// single-row callers, and it now carries the same invariants (#586).
//
// It used to update on transaction_id + user_id alone, which made a fund-scoped
// endpoint into a generic goal writer:
//
//   • any asset type could be moved through it, bypassing the checks the
//     canonical route applies to bank deposits;
//   • an accumulating book tranche was moved on its own — goal is book-level, so
//     that splits the book across two goals and the halves can no longer be
//     repaired from the UI (a fund row shows one aggregate per fund);
//   • the target goal was never checked for ownership, so a known foreign goal
//     id could be stamped onto the caller's row (#474).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body
  const { goal_id } = body

  let txId: string
  let cleanGoalId: string | null = null
  try {
    txId = validateUUID(id, 'transaction_id')
    if (goal_id !== null && goal_id !== undefined && goal_id !== '') {
      cleanGoalId = validateUUID(goal_id, 'goal_id')
    }
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const { data: existing } = await supabase
    .from('investment_transactions')
    .select('transaction_id, asset_type, deposit_group_id')
    .eq('transaction_id', txId)
    .eq('user_id', user.id)
    .maybeSingle()

  // A non-fund id is not a resource this endpoint addresses, so it reads as
  // absent rather than forbidden — and it tells a caller holding a bank/stock/
  // gold id nothing about whether that row exists.
  if (!existing || existing.asset_type !== 'fund') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // A valid UUID is not proof of ownership, and goal_id carries no FK back to
  // the caller — an unchecked write would link this holding to another user's
  // goal and report success.
  if (cleanGoalId) {
    const { data: goal } = await supabase
      .from('savings_goals')
      .select('goal_id')
      .eq('goal_id', cleanGoalId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!goal) return NextResponse.json({ error: "You don't have permission to access this goal." }, { status: 403 })
  }

  // Books are created as bank deposits. POST /investment-transactions used to
  // group any asset type when asked, so a fund row CAN carry a deposit_group_id
  // — it no longer creates one (#618: the route refuses it and the table carries
  // the rule), which leaves only rows written before that.
  // goal is book-level, so such a row has to move with its whole group — through
  // the same single-transaction RPC the canonical PUT uses. Doing the row update
  // and the cascade as two statements risks a partial failure that splits the
  // book, so a failed RPC fails the request rather than falling back.
  if (existing.deposit_group_id) {
    const { data: row, error: bookErr } = await supabase
      .rpc('update_deposit_book', {
        p_tx_id: txId,
        p_set_goal: true, p_goal_id: cleanGoalId,
        p_set_expiry: false, p_expiry_date: null,
        p_set_amount: false, p_amount_vnd: null,
        p_set_rate: false, p_interest_rate: null,
        p_set_investment: false, p_investment_date: null,
        p_set_notes: false, p_notes: null,
        p_set_bank: false, p_bank_code: null,
      })
      .single()
    if (bookErr || !row) {
      console.error('fund-investments goal: atomic book edit failed', bookErr?.message)
      return NextResponse.json({ error: 'Failed to update deposit book' }, { status: 500 })
    }
    return NextResponse.json(row)
  }

  // The read above classifies; this filter is the guard. asset_type could change
  // between the two statements, so the UPDATE carries the condition itself and
  // Postgres re-evaluates it against the committed row.
  const { data, error } = await supabase
    .from('investment_transactions')
    .update({ goal_id: cleanGoalId, updated_at: new Date().toISOString() })
    .eq('transaction_id', txId)
    .eq('user_id', user.id)
    .eq('asset_type', 'fund')
    .select()
    .single()

  // ...before the catch-all, which would answer 'Not found' about a
  // transaction that is sitting right there (#650).
  const doneErr = completedGoalError(error)
  if (doneErr) return doneErr
  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(data)
}
