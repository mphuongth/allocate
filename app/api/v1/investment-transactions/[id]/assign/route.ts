import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateUUID } from '@/lib/validation'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
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

  if (cleanGoalId) {
    const { data: goal } = await supabase
      .from('savings_goals')
      .select('goal_id')
      .eq('goal_id', cleanGoalId)
      .eq('user_id', user.id)
      .single()
    if (!goal) return NextResponse.json({ error: "You don't have permission to access this goal." }, { status: 403 })
  }

  // An accumulating book shares one goal across all tranches. Assigning a book
  // (its anchor) must move the WHOLE group, or it splits across goals — so route a
  // book through the atomic cascade RPC (goal_id only; no tranche-level changes).
  // Non-book holdings take the plain single-row update below.
  const { data: existing } = await supabase
    .from('investment_transactions')
    .select('deposit_group_id')
    .eq('transaction_id', txId)
    .eq('user_id', user.id)
    .single()
  if (!existing) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })

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
      })
      .single()
    if (bookErr || !row) {
      console.error('assign: book cascade failed', bookErr?.message)
      return NextResponse.json({ error: 'Failed to assign deposit book' }, { status: 500 })
    }
    return NextResponse.json(row)
  }

  const { data: transaction, error } = await supabase
    .from('investment_transactions')
    .update({ goal_id: cleanGoalId, updated_at: new Date().toISOString() })
    .eq('transaction_id', txId)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error || !transaction) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  return NextResponse.json(transaction)
}
