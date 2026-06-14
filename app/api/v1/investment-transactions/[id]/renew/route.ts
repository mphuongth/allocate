import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateDate, validateRate, validateUUID } from '@/lib/validation'
import { isFutureInvestmentDate } from '@/lib/dates'
import { isTermDeposit } from '@/lib/maturity'

// Renew a bank term deposit.
//
// The renewal performs three coupled writes — roll the active row forward to
// the new cycle (in place), append a history snapshot of the cycle that just
// closed, and re-parent that cycle's partial-withdrawal rows onto the snapshot.
// The re-parent is correctness-critical: leaving a withdrawal attached to the
// now-renewed active row subtracts it from net worth a second time (the exact
// double-count this guards against). So all three run inside the
// `renew_term_deposit` Postgres function as a single transaction — they commit
// together or roll back together, leaving no intermediate double-count state and
// never returning 200 on a partial write.
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

  if (isFutureInvestmentDate(cleanInvestmentDate)) {
    return NextResponse.json({ error: 'Investment date cannot be in the future.' }, { status: 400 })
  }

  // Validate against the current cycle (owned by this user) for friendly 4xx
  // messages. The renewal itself re-reads and locks the row inside
  // renew_term_deposit, which builds the snapshot from that authoritative read.
  const { data: old, error: fetchErr } = await supabase
    .from('investment_transactions')
    .select('asset_type, amount_vnd, interest_rate, expiry_date')
    .eq('transaction_id', txId)
    .eq('user_id', user.id)
    .single()
  if (fetchErr || !old) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  // Only a bank TERM deposit can be renewed: it must carry both an interest rate
  // and a maturity date. A flexible bank deposit (rate/expiry null) has no cycle
  // to roll forward — renewing it would invent a maturity and interest it never
  // had. The asset_type==='bank' check alone let flex deposits through, so guard
  // on the full term-deposit shape (mirrored in renew_term_deposit for callers
  // hitting the RPC directly).
  if (!isTermDeposit({ type: old.asset_type, interestRate: old.interest_rate, expiryDate: old.expiry_date })) {
    return NextResponse.json({ error: 'Only bank term deposits can be renewed.' }, { status: 400 })
  }

  // Sanity-bound the realized interest against the OLD principal it accrued on
  // (not the new cycle's principal, which a "change amount" renewal may shrink).
  if (cleanInterestEarned != null && cleanInterestEarned > old.amount_vnd * 10) {
    return NextResponse.json({ error: 'interest_earned_vnd is unreasonably large' }, { status: 400 })
  }

  // Perform the three coupled writes (roll forward, snapshot, re-parent
  // withdrawals) atomically. The re-parent is correctness-critical — a partial
  // success that skipped it would silently double-count the withdrawn amount —
  // so a failure here aborts the whole renewal rather than returning 200.
  const { data: renewed, error: renewErr } = await supabase
    .rpc('renew_term_deposit', {
      p_tx_id: txId,
      p_amount_vnd: Math.round(cleanAmount),
      p_interest_rate: cleanRate,
      p_expiry_date: cleanExpiry,
      p_investment_date: cleanInvestmentDate,
      p_interest_earned_vnd: cleanInterestEarned,
    })
    .single()
  if (renewErr || !renewed) {
    console.error('renew: atomic renewal failed', renewErr?.message)
    return NextResponse.json({ error: 'Failed to renew deposit' }, { status: 500 })
  }

  return NextResponse.json(renewed)
}
