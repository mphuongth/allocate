import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateDate, validateUUID } from '@/lib/validation'
import { isFutureInvestmentDate } from '@/lib/dates'

// Close a whole accumulating ("Loại 2") book to cash. `id` is the book anchor
// (= deposit_group_id). One atomic RPC writes a withdrawal row per live tranche
// (full principal each), so the book nets to zero and drops out of the holdings.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { total_received, investment_date, affects_progress } = body

  let bookId: string
  let cleanReceived: number
  let cleanDate: string
  try {
    bookId = validateUUID(id, 'book_id')
    cleanReceived = validateAmount(total_received, 'total_received')
    if (cleanReceived < 0) throw new ValidationError('total_received must be non-negative')
    cleanDate = validateDate(investment_date, 'investment_date')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }
  if (isFutureInvestmentDate(cleanDate)) {
    return NextResponse.json({ error: 'Withdrawal date cannot be in the future.' }, { status: 400 })
  }

  // Verify the book is owned by the caller (the RPC re-checks under FOR UPDATE).
  const { data: anchor } = await supabase
    .from('investment_transactions')
    .select('asset_type, deposit_group_id')
    .eq('transaction_id', bookId)
    .eq('user_id', user.id)
    .single()
  if (!anchor) return NextResponse.json({ error: 'Deposit not found' }, { status: 404 })
  if (anchor.asset_type !== 'bank' || anchor.deposit_group_id !== bookId) {
    return NextResponse.json({ error: 'Only an accumulating book can be closed this way.' }, { status: 400 })
  }

  const { data: count, error } = await supabase
    .rpc('withdraw_accumulating_book', {
      p_book_id: bookId,
      p_total_received: Math.round(cleanReceived),
      p_investment_date: cleanDate,
      p_affects_progress: affects_progress !== false,
    })
  if (error) {
    if (error.message?.includes('nothing to withdraw')) {
      return NextResponse.json({ error: 'This book has no balance to withdraw.' }, { status: 400 })
    }
    console.error('withdraw_accumulating_book failed', error.message)
    return NextResponse.json({ error: 'Failed to withdraw book' }, { status: 500 })
  }

  return NextResponse.json({ withdrawn_tranches: count })
}
