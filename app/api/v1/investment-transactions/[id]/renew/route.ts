import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateDate, validateRate, validateUUID } from '@/lib/validation'

// Renew a bank term deposit.
//
// The active deposit row is updated in place to the new cycle (new principal /
// rate / maturity, accrual date reset to today) — its valuation is unchanged
// from a plain edit. To preserve the history the overwrite would erase, we then
// append a history-only "snapshot" of the cycle that just closed, linked via
// `renewed_from_transaction_id`. The snapshot is never counted anywhere it is
// excluded by that link, so the two writes don't need to be atomic: the
// snapshot is best-effort and a failure there only drops a history row, never
// double-counts.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { amount_vnd, interest_rate, expiry_date, investment_date, interest_earned_vnd } = body

  let txId: string
  let cleanAmount: number
  let cleanRate: number | null = null
  let cleanExpiry: string | null = null
  let cleanInvestmentDate: string
  let cleanInterestEarned: number | null = null
  try {
    txId = validateUUID(id, 'transaction_id')
    cleanAmount = validateAmount(amount_vnd, 'amount_vnd')
    if (cleanAmount <= 0) throw new ValidationError('amount_vnd must be positive')
    if (interest_rate != null && interest_rate !== '') cleanRate = validateRate(interest_rate, 'interest_rate')
    if (expiry_date) cleanExpiry = validateDate(expiry_date, 'expiry_date')
    cleanInvestmentDate = validateDate(investment_date, 'investment_date')
    // Realized interest is user-entered money recorded permanently — must be a
    // non-negative finite number. The upper bound is checked after the old row
    // is read (interest accrued on the OLD principal, not the new cycle's).
    if (interest_earned_vnd != null && interest_earned_vnd !== '') {
      const n = Number(interest_earned_vnd)
      if (!Number.isFinite(n) || n < 0) throw new ValidationError('interest_earned_vnd must be a non-negative number')
      cleanInterestEarned = Math.round(n)
    }
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  if (new Date(cleanInvestmentDate) > new Date()) {
    return NextResponse.json({ error: 'Investment date cannot be in the future.' }, { status: 400 })
  }

  // Read the current cycle (owned by this user) before overwriting it.
  const { data: old, error: fetchErr } = await supabase
    .from('investment_transactions')
    .select('transaction_id, user_id, goal_id, asset_type, amount_vnd, investment_date, expiry_date, interest_rate, notes')
    .eq('transaction_id', txId)
    .eq('user_id', user.id)
    .single()
  if (fetchErr || !old) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  if (old.asset_type !== 'bank') {
    return NextResponse.json({ error: 'Only bank term deposits can be renewed.' }, { status: 400 })
  }

  // Sanity-bound the realized interest against the OLD principal it accrued on
  // (not the new cycle's principal, which a "change amount" renewal may shrink).
  if (cleanInterestEarned != null && cleanInterestEarned > old.amount_vnd * 10) {
    return NextResponse.json({ error: 'interest_earned_vnd is unreasonably large' }, { status: 400 })
  }

  // Roll the active row forward to the new cycle (in place — valuation unchanged).
  const { data: renewed, error: updateErr } = await supabase
    .from('investment_transactions')
    .update({
      amount_vnd: Math.round(cleanAmount),
      interest_rate: cleanRate,
      expiry_date: cleanExpiry,
      investment_date: cleanInvestmentDate,
      updated_at: new Date().toISOString(),
    })
    .eq('transaction_id', txId)
    .eq('user_id', user.id)
    .select()
    .single()
  if (updateErr || !renewed) return NextResponse.json({ error: 'Failed to renew deposit' }, { status: 500 })

  // Best-effort: append a history snapshot of the cycle that just closed. A
  // failure here doesn't undo the renewal — it only loses a history row, never
  // affects totals (the snapshot is excluded from valuation by its link).
  const { error: snapshotErr } = await supabase
    .from('investment_transactions')
    .insert({
      user_id: user.id,
      goal_id: old.goal_id,
      asset_type: 'bank',
      transaction_type: 'investment',
      amount_vnd: old.amount_vnd,
      investment_date: old.investment_date,
      expiry_date: old.expiry_date,
      interest_rate: old.interest_rate,
      notes: old.notes,
      renewed_from_transaction_id: txId,
      interest_earned_vnd: cleanInterestEarned,
      affects_progress: false,
    })
  if (snapshotErr) console.error('renew: failed to write history snapshot', snapshotErr.message)

  return NextResponse.json(renewed)
}
