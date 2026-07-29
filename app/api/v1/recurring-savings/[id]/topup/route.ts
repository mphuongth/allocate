import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateDate, validateRate, validateUUID, validateYearMonth } from '@/lib/validation'
import { isFutureInvestmentDate } from '@/lib/dates'
import { readJsonBody } from '@/lib/apiBody'

// Record this month's recurring saving as a top-up into its linked accumulating
// book: add a real tranche AND mark the recurring fulfilled for the month, in one
// atomic RPC (so the amount can't be double-counted — see
// record_recurring_book_topup). The recurring must be linked to exactly this book
// (its anchor); a tranche needs its own rate, which the client supplies (recurring
// savings don't store one).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body
  const { book_id, amount_vnd, interest_rate, investment_date, ym, plan_id } = body

  let savingId: string
  let bookId: string
  let cleanAmount: number
  let cleanRate: number
  let cleanDate: string
  let cleanYm: string
  let cleanPlanId: string | null = null
  try {
    savingId = validateUUID(id, 'saving_id')
    bookId = validateUUID(book_id, 'book_id')
    cleanAmount = validateAmount(amount_vnd, 'amount_vnd')
    if (cleanAmount <= 0) throw new ValidationError('amount_vnd must be positive')
    // A tranche locks in its own rate — required (a book values each tranche on it).
    if (interest_rate == null || interest_rate === '') throw new ValidationError('interest_rate is required')
    cleanRate = validateRate(interest_rate, 'interest_rate')
    cleanDate = validateDate(investment_date, 'investment_date')
    cleanYm = validateYearMonth(ym, 'ym')
    if (plan_id) cleanPlanId = validateUUID(plan_id, 'plan_id')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  if (isFutureInvestmentDate(cleanDate)) {
    return NextResponse.json({ error: 'Investment date cannot be in the future.' }, { status: 400 })
  }

  // The recurring must exist, be owned by the caller, and be linked to exactly
  // this book — this endpoint only materializes a recurring into its own linked book.
  const { data: saving } = await supabase
    .from('recurring_savings')
    .select('linked_deposit_tx_id')
    .eq('saving_id', savingId)
    .eq('user_id', user.id)
    .single()
  if (!saving) return NextResponse.json({ error: 'Recurring saving not found' }, { status: 404 })
  if (saving.linked_deposit_tx_id !== bookId) {
    return NextResponse.json({ error: 'This recurring saving is not linked to that book.' }, { status: 400 })
  }

  // Verify plan ownership before tagging the tranche with it (the tranche's plan_id
  // drives the By-goal "contributed" total). Reads are user-scoped, but reject a
  // foreign/stale plan id at write time — same hygiene as the link-ownership checks.
  if (cleanPlanId) {
    const { data: plan } = await supabase
      .from('monthly_plans')
      .select('id')
      .eq('id', cleanPlanId)
      .eq('user_id', user.id)
      .single()
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  }

  const { data: tranche, error } = await supabase
    .rpc('record_recurring_book_topup', {
      p_book_id: bookId,
      p_amount_vnd: Math.round(cleanAmount),
      p_interest_rate: cleanRate,
      p_investment_date: cleanDate,
      p_saving_id: savingId,
      p_ym: cleanYm,
      p_plan_id: cleanPlanId,
    })
    .single()
  if (error || !tranche) {
    const msg = error?.message ?? ''
    if (msg.includes('cannot top up a matured book')) {
      return NextResponse.json({ error: 'Cannot top up a deposit that has already matured.' }, { status: 400 })
    }
    if (msg.includes('accumulating book not found')) {
      return NextResponse.json({ error: 'Linked book not found.' }, { status: 404 })
    }
    console.error('record_recurring_book_topup failed', msg)
    return NextResponse.json({ error: 'Failed to record top-up' }, { status: 500 })
  }

  return NextResponse.json(tranche, { status: 201 })
}
