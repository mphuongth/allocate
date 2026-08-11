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
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body
  const { received_vnd, interest_rate, merge_date, tranche_ids } = body

  let bookId: string
  let cleanReceived: number
  let cleanRate: number
  let cleanDate: string
  let cleanTrancheIds: string[]
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
