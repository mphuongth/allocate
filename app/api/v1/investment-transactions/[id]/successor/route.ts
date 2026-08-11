import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateDate, validateNotes, validateRate, validateUUID, validateYearMonth } from '@/lib/validation'
import { isFutureInvestmentDate } from '@/lib/dates'
import { readJsonBody } from '@/lib/apiBody'

// Open the accumulating book that takes over from one the bank will no longer
// top up (#638). The new book opens with the contribution that could not go into
// the old one; the user supplies its maturity and rate, since those are the
// bank's terms for a new deposit and nothing in the old book predicts them.
//
// When the contribution came from a recurring saving, the same call also files
// the month and moves the saving's link — one RPC, because a half-applied
// version of that is a plan that asks for the month again or a contribution
// recorded in a book nothing points at.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body
  const { amount_vnd, interest_rate, investment_date, expiry_date, top_up_lock_days, notes, saving_id, ym, plan_id } = body

  let bookId: string
  let cleanAmount: number
  let cleanRate: number | null = null
  let cleanDate: string
  let cleanExpiry: string
  let cleanLockDays: number | null = null
  let cleanNotes: string | null = null
  let cleanSavingId: string | null = null
  let cleanYm: string | null = null
  let cleanPlanId: string | null = null
  try {
    bookId = validateUUID(id, 'id')
    cleanAmount = validateAmount(amount_vnd, 'amount_vnd')
    if (cleanAmount <= 0) throw new ValidationError('amount_vnd must be positive')
    // The new book opens holding real money, so it needs the rate that money
    // earns — and a rateless deposit is not a valid target for a recurring link.
    if (interest_rate == null || interest_rate === '') throw new ValidationError('interest_rate is required')
    cleanRate = validateRate(interest_rate, 'interest_rate')
    if (!(cleanRate > 0)) throw new ValidationError('interest_rate must be positive')
    cleanDate = validateDate(investment_date, 'investment_date')
    cleanExpiry = validateDate(expiry_date, 'expiry_date')
    if (cleanExpiry <= cleanDate) throw new ValidationError('expiry_date must be after investment_date')
    if (top_up_lock_days != null && top_up_lock_days !== '') {
      const lockDays = Number(top_up_lock_days)
      if (!Number.isInteger(lockDays) || lockDays < 0 || lockDays > 3650) throw new ValidationError('top_up_lock_days must be a whole number from 0 to 3650')
      cleanLockDays = lockDays
    }
    if (notes != null && notes !== '') cleanNotes = validateNotes(notes)
    if (saving_id) {
      cleanSavingId = validateUUID(saving_id, 'saving_id')
      cleanYm = validateYearMonth(ym, 'ym')
    }
    if (plan_id) cleanPlanId = validateUUID(plan_id, 'plan_id')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  if (isFutureInvestmentDate(cleanDate)) {
    return NextResponse.json({ error: 'Contribution date cannot be in the future.' }, { status: 400 })
  }

  // The RPC checks this too — it has to, being the only thing a direct caller
  // goes through — but a wrong link is a user-correctable mistake, so answer it
  // here where it can be phrased as one.
  if (cleanSavingId) {
    const { data: saving } = await supabase
      .from('recurring_savings')
      .select('linked_deposit_tx_id')
      .eq('saving_id', cleanSavingId)
      .eq('user_id', user.id)
      .single()
    if (!saving) return NextResponse.json({ error: 'Recurring saving not found' }, { status: 404 })
    if (saving.linked_deposit_tx_id !== bookId) {
      return NextResponse.json({ error: 'This recurring saving is not linked to that book.' }, { status: 400 })
    }
  }

  if (cleanPlanId) {
    const { data: plan } = await supabase
      .from('monthly_plans')
      .select('id, month, year')
      .eq('id', cleanPlanId)
      .eq('user_id', user.id)
      .single()
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    // The tranche is tagged with the plan while the fulfillment is filed under
    // `ym`. If those disagree, one month shows a contribution it cannot find the
    // deposit for, and another counts a deposit it never planned.
    if (cleanYm && `${plan.year}-${String(plan.month).padStart(2, '0')}` !== cleanYm) {
      return NextResponse.json({ error: 'The plan and the contribution month must be the same month.' }, { status: 400 })
    }
  }

  const { data: book, error } = await supabase
    .rpc('open_successor_book', {
      p_source_book_id: bookId,
      p_amount_vnd: Math.round(cleanAmount),
      p_interest_rate: cleanRate,
      p_investment_date: cleanDate,
      p_expiry_date: cleanExpiry,
      p_top_up_lock_days: cleanLockDays,
      p_notes: cleanNotes,
      p_saving_id: cleanSavingId,
      p_ym: cleanYm,
      p_plan_id: cleanPlanId,
    })
    .single()

  if (error || !book) {
    const msg = error?.message ?? ''
    if (msg.includes('accumulating book not found')) {
      return NextResponse.json({ error: 'Accumulating book not found.' }, { status: 404 })
    }
    if (msg.includes('already has a successor')) {
      return NextResponse.json({ error: 'This book already has a successor.', code: 'successor_exists' }, { status: 400 })
    }
    // Every other refusal this family raises is a rule the user can satisfy by
    // changing what they typed, so the message goes back as-is rather than
    // becoming an anonymous server fault.
    if (msg.startsWith('successor book: ')) {
      return NextResponse.json({ error: msg.slice('successor book: '.length), code: 'successor_refused' }, { status: 400 })
    }
    console.error('open_successor_book failed', msg)
    return NextResponse.json({ error: 'Failed to open the successor book' }, { status: 500 })
  }

  return NextResponse.json(book, { status: 201 })
}

// Cancel a planned handover. The database will not let a promised book be closed
// or collapsed — losing the plan at maturity is exactly the failure the link
// exists to prevent — so the way out is to withdraw the promise on purpose.
// The successor book itself stays: it holds real money and is nobody's to delete
// from here.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let bookId: string
  try {
    bookId = validateUUID(id, 'id')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const { data: book, error } = await supabase
    .from('investment_transactions')
    .update({ successor_deposit_tx_id: null, updated_at: new Date().toISOString() })
    .eq('transaction_id', bookId)
    .eq('user_id', user.id)
    .select('transaction_id')
    .single()

  if (error || !book) {
    if (error) console.error('cancel successor failed', error.message)
    return NextResponse.json({ error: 'Deposit not found' }, { status: 404 })
  }
  return NextResponse.json({ transaction_id: book.transaction_id, successor_deposit_tx_id: null })
}
