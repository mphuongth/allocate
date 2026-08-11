import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateDate, validateRate, validateUUID } from '@/lib/validation'
import { isFutureInvestmentDate } from '@/lib/dates'
import { readJsonBody } from '@/lib/apiBody'

// Keep the promise: fold a matured accumulating book into the successor it was
// handed to (#638, Phase 3). `id` is the source book's anchor.
//
// Everything that has to happen together happens in merge_book_into_successor —
// closing every tranche, allocating the cash the bank actually paid across them,
// recording it as one tranche in the new book, moving what still funded the old
// one, and retiring the promise. The route validates, names the tranches it saw
// so the RPC can refuse a book that changed underneath, and turns refusals into
// answers.
// What the book actually holds, straight from the source. The goal page caps at
// 200 rows and backfills only missing anchors, so a large goal hands the sheet a
// partial book — and a partial book can never satisfy the RPC's tranche check,
// however many times it is reloaded. So the confirmation asks here instead.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const { data: rows, error } = await supabase
    .from('investment_transactions')
    .select('transaction_id, transaction_type, parent_transaction_id, amount_vnd, principal_withdrawn, interest_rate, investment_date, expiry_date, deposit_group_id, renewed_from_transaction_id')
    .eq('user_id', user.id)
    .or(`deposit_group_id.eq.${bookId},parent_transaction_id.not.is.null`)
    .limit(2000)

  if (error) {
    console.error('merge preview failed', error.message)
    return NextResponse.json({ error: 'Failed to read the book' }, { status: 500 })
  }

  const all = rows ?? []
  const tranchesRows = all.filter((r) => r.deposit_group_id === bookId
    && r.transaction_type === 'investment' && !r.renewed_from_transaction_id)
  const withdrawnBy = new Map<string, number>()
  for (const r of all) {
    if (r.transaction_type !== 'withdrawal' || !r.parent_transaction_id) continue
    withdrawnBy.set(r.parent_transaction_id, (withdrawnBy.get(r.parent_transaction_id) ?? 0) + (r.principal_withdrawn ?? 0))
  }

  // Only what still holds something: a spent tranche is not the caller's to
  // account for, and the RPC skips it for the same reason.
  const tranches = tranchesRows
    .map((r) => ({
      transaction_id: r.transaction_id,
      investment_date: r.investment_date,
      interest_rate: r.interest_rate,
      effective_principal: (r.amount_vnd ?? 0) - (withdrawnBy.get(r.transaction_id) ?? 0),
    }))
    .filter((t) => t.effective_principal > 0)

  if (tranches.length === 0) {
    return NextResponse.json({ error: 'Accumulating book not found.' }, { status: 404 })
  }
  return NextResponse.json({
    tranches,
    effective_principal: tranches.reduce((sum, t) => sum + t.effective_principal, 0),
  })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body
  const { received_vnd, interest_rate, merge_date, tranche_ids, tranche_principals } = body

  let bookId: string
  let cleanReceived: number
  let cleanRate: number
  let cleanDate: string
  let cleanTrancheIds: string[]
  let cleanTranchePrincipals: number[]
  try {
    bookId = validateUUID(id, 'id')
    cleanReceived = validateAmount(received_vnd, 'received_vnd')
    if (cleanReceived <= 0) throw new ValidationError('received_vnd must be positive')
    if (interest_rate == null || interest_rate === '') throw new ValidationError('interest_rate is required')
    cleanRate = validateRate(interest_rate, 'interest_rate')
    if (!(cleanRate > 0)) throw new ValidationError('interest_rate must be positive')
    cleanDate = validateDate(merge_date, 'merge_date')
    if (!Array.isArray(tranche_ids) || tranche_ids.length === 0) {
      throw new ValidationError('tranche_ids is required')
    }
    if (tranche_ids.length > 500) throw new ValidationError('tranche_ids is too long')
    cleanTrancheIds = tranche_ids.map((v, i) => validateUUID(v, `tranche_ids[${i}]`))
    // The balances the client saw, not just which rows it saw: a partial
    // withdrawal landing after the confirmation loaded leaves every id in place
    // while the payout being confirmed is no longer one this book can make.
    if (!Array.isArray(tranche_principals) || tranche_principals.length !== cleanTrancheIds.length) {
      throw new ValidationError('tranche_principals must match tranche_ids')
    }
    cleanTranchePrincipals = tranche_principals.map((v, i) => Math.round(validateAmount(v, `tranche_principals[${i}]`)))
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  if (isFutureInvestmentDate(cleanDate)) {
    return NextResponse.json({ error: 'The merge date cannot be in the future.' }, { status: 400 })
  }

  const { data: merged, error } = await supabase
    .rpc('merge_book_into_successor', {
      p_source_book_id: bookId,
      p_received_vnd: Math.round(cleanReceived),
      p_interest_rate: cleanRate,
      p_merge_date: cleanDate,
      p_tranche_ids: cleanTrancheIds,
      p_tranche_principals: cleanTranchePrincipals,
    })
    .single<{ transaction_id: string }>()

  if (error || !merged) {
    const msg = error?.message ?? ''
    // The book took a top-up while the confirmation was open, so the cash the
    // user is confirming is not the cash the book holds. Reload and look again.
    if (msg.includes('book changed since load')) {
      return NextResponse.json(
        { error: 'This book changed — please reload and try again.', code: 'book_changed' },
        { status: 409 },
      )
    }
    if (msg.includes('not found') || msg.includes('successor book is gone')) {
      return NextResponse.json({ error: 'Accumulating book not found.' }, { status: 404 })
    }
    // Everything else this family raises is a rule the user can satisfy — the
    // book is not due yet, the successor has closed its own door, the amount is
    // not one this book could have paid out.
    if (msg.startsWith('merge successor: ')) {
      return NextResponse.json(
        { error: msg.slice('merge successor: '.length), code: 'merge_refused' },
        { status: 400 },
      )
    }
    if (msg.startsWith('accumulating top-up: ')) {
      return NextResponse.json(
        { error: msg.slice('accumulating top-up: '.length), code: 'successor_closed' },
        { status: 400 },
      )
    }
    console.error('merge_book_into_successor failed', msg)
    return NextResponse.json({ error: 'Failed to merge the book' }, { status: 500 })
  }

  return NextResponse.json(merged, { status: 201 })
}
