import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateDate, validateUUID } from '@/lib/validation'
import { isFutureInvestmentDate } from '@/lib/dates'
import { readJsonBody } from '@/lib/apiBody'
import { contentionError } from '@/lib/contention'

// Withdraw from an accumulating ("Loại 2") book. `id` is the book anchor
// (= deposit_group_id). One atomic RPC spreads `withdraw_principal` across the live
// tranches proportionally (a full close is withdraw_principal = total principal),
// so a partial leaves the book's blended rate intact and a full one nets it to zero.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body
  const { withdraw_principal, total_received, investment_date, affects_progress } = body

  let bookId: string
  let cleanPrincipal: number
  let cleanReceived: number
  let cleanDate: string
  try {
    bookId = validateUUID(id, 'book_id')
    cleanPrincipal = validateAmount(withdraw_principal, 'withdraw_principal')
    if (cleanPrincipal <= 0) throw new ValidationError('withdraw_principal must be positive')
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
      p_withdraw_principal: Math.round(cleanPrincipal),
      p_total_received: Math.round(cleanReceived),
      p_investment_date: cleanDate,
      p_affects_progress: affects_progress !== false,
    })
  if (error) {
    if (error.message?.includes('nothing to withdraw') || error.message?.includes('more than the book balance')) {
      return NextResponse.json({ error: 'Withdrawal exceeds the book balance.' }, { status: 400 })
    }
    // A book promised to a successor is not closed behind the promise's back
    // (#638). That is a decision to undo, not a fault — say which one.
    if (error.message?.startsWith('successor book: ')) {
      return NextResponse.json(
        { error: error.message.slice('successor book: '.length), code: 'successor_planned' },
        { status: 409 },
      )
    }
    // A close locks the anchor and then each tranche; an ordinary withdrawal from
    // one of those tranches holds it and then waits for the anchor (#650). Two at
    // once can deadlock — nothing written, nothing wrong with the request.
    const busy = contentionError(
      error,
      'This book was being changed at the same time. Nothing was withdrawn — try again.',
      'book_busy',
    )
    if (busy) return busy
    console.error('withdraw_accumulating_book failed', error.message)
    return NextResponse.json({ error: 'Failed to withdraw book' }, { status: 500 })
  }

  return NextResponse.json({ withdrawn_tranches: count })
}
