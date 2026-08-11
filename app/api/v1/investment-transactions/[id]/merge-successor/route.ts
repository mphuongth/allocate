import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateDate, validateRate, validateUUID } from '@/lib/validation'
import { isFutureInvestmentDate } from '@/lib/dates'
import { readJsonBody } from '@/lib/apiBody'
import { buildCollapsePlan } from '@/lib/accumulating'

// One ceiling for the preview and the write. Reaching it is reported rather than
// silently truncated — a short preview can never satisfy the RPC, and the merge
// would fail with book_changed forever.
const MERGE_TRANCHE_LIMIT = 2000
// PostgREST caps a response at config.toml's max_rows, so asking for more in one
// request quietly returns fewer. Pages of this size, read until one comes back
// short, are how the whole book is actually seen.
const PAGE = 500

async function readAllPages<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  ceiling: number,
): Promise<{ rows: T[]; error?: string; truncated?: boolean }> {
  const rows: T[] = []
  for (let from = 0; from <= ceiling; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1)
    if (error) return { rows, error: error.message }
    const page = data ?? []
    rows.push(...page)
    // Ceiling first: a short page that arrives ALREADY over the limit was
    // returning as a complete read, so the preview handed back more than the
    // write would accept and the book could never be merged.
    if (rows.length > ceiling) return { rows, truncated: true }
    if (page.length < PAGE) return { rows }
  }
  return { rows, truncated: true }
}

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

  // The book first, then only the withdrawals that belong to it. Asking for
  // every parented row the user owns and filtering afterwards is bounded by the
  // whole account rather than by this book — and anything the cap drops comes
  // back as a permanent `book_changed` that reloading cannot fix.
  const tranchePages = await readAllPages<{
    transaction_id: string; amount_vnd: number | null; interest_rate: number | null
    investment_date: string; expiry_date: string | null; successor_deposit_tx_id: string | null
  }>((from, to) => supabase
    .from('investment_transactions')
    .select('transaction_id, amount_vnd, interest_rate, investment_date, expiry_date, successor_deposit_tx_id')
    .eq('user_id', user.id)
    .eq('deposit_group_id', bookId)
    .eq('transaction_type', 'investment')
    .is('renewed_from_transaction_id', null)
    .order('transaction_id')
    .range(from, to), MERGE_TRANCHE_LIMIT)

  if (tranchePages.error) {
    console.error('merge preview failed', tranchePages.error)
    return NextResponse.json({ error: 'Failed to read the book' }, { status: 500 })
  }

  const tranchesRows = tranchePages.rows
  if (tranchePages.truncated) {
    return NextResponse.json(
      { error: 'This book has more tranches than the merge can take at once.', code: 'book_too_large' },
      { status: 422 },
    )
  }
  const withdrawnBy = new Map<string, number>()
  if (tranchesRows.length > 0) {
    const ids = tranchesRows.map((r) => r.transaction_id)
    // A book can carry more withdrawals than tranches, so this is paged too.
    const wPages = await readAllPages<{ parent_transaction_id: string | null; principal_withdrawn: number | null }>(
      (from, to) => supabase
        .from('investment_transactions')
        .select('parent_transaction_id, principal_withdrawn')
        .eq('user_id', user.id)
        .eq('transaction_type', 'withdrawal')
        .in('parent_transaction_id', ids)
        .order('transaction_id')
        .range(from, to), MERGE_TRANCHE_LIMIT * 4)
    if (wPages.error) {
      console.error('merge preview failed', wPages.error)
      return NextResponse.json({ error: 'Failed to read the book' }, { status: 500 })
    }
    if (wPages.truncated) {
      return NextResponse.json(
        { error: 'This book has more history than the merge can take at once.', code: 'book_too_large' },
        { status: 422 },
      )
    }
    for (const w of wPages.rows) {
      if (!w.parent_transaction_id) continue
      withdrawnBy.set(w.parent_transaction_id, (withdrawnBy.get(w.parent_transaction_id) ?? 0) + (w.principal_withdrawn ?? 0))
    }
  }

  // Only what still holds something: a spent tranche is not the caller's to
  // account for, and the RPC skips it for the same reason.
  const tranches = tranchesRows
    .map((r) => ({
      transaction_id: r.transaction_id,
      investment_date: r.investment_date,
      interest_rate: r.interest_rate,
      expiry_date: r.expiry_date,
      effective_principal: (r.amount_vnd ?? 0) - (withdrawnBy.get(r.transaction_id) ?? 0),
    }))
    .filter((t) => t.effective_principal > 0)

  if (tranches.length === 0) {
    return NextResponse.json({ error: 'Accumulating book not found.' }, { status: 404 })
  }
  // What the bank pays out: the principal still held plus the interest it
  // accrued, valued with the one formula the collapse route uses. The sheet's
  // default came from the goal page's own valuation, which is computed from a
  // capped list — on a large goal it understated the payout, and the RPC only
  // bounds a payout from ABOVE, so submitting the default quietly credited the
  // successor with too little.
  const plan = buildCollapsePlan(tranches.map((t) => ({
    id: t.transaction_id,
    principal: t.effective_principal,
    rate: t.interest_rate,
    investmentDate: t.investment_date,
    expiryDate: t.expiry_date,
  })))
  return NextResponse.json({
    tranches,
    // Which book this one is promised to right now. The confirmation submits it
    // back, so a handover cancelled and re-made in the meantime is caught rather
    // than silently paid out to the replacement.
    successor_id: tranchesRows.find((r) => r.transaction_id === bookId)?.successor_deposit_tx_id ?? null,
    effective_principal: plan.totalPrincipal,
    projected_value: plan.totalPrincipal + plan.totalInterest,
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
  const { received_vnd, interest_rate, merge_date, tranche_ids, tranche_principals, expected_successor_id } = body

  let bookId: string
  let cleanReceived: number
  let cleanRate: number
  let cleanDate: string
  let cleanTrancheIds: string[]
  let cleanTranchePrincipals: number[]
  let cleanExpectedSuccessor: string
  try {
    bookId = validateUUID(id, 'id')
    // The destination the sheet showed. A handover can be cancelled and re-made
    // while the confirmation is open, and the replacement satisfies every rule
    // the pairing enforces — so the only thing that can catch it is the caller
    // saying which book they were looking at.
    cleanExpectedSuccessor = validateUUID(expected_successor_id, 'expected_successor_id')
    cleanReceived = validateAmount(received_vnd, 'received_vnd')
    if (cleanReceived <= 0) throw new ValidationError('received_vnd must be positive')
    if (interest_rate == null || interest_rate === '') throw new ValidationError('interest_rate is required')
    cleanRate = validateRate(interest_rate, 'interest_rate')
    if (!(cleanRate > 0)) throw new ValidationError('interest_rate must be positive')
    cleanDate = validateDate(merge_date, 'merge_date')
    if (!Array.isArray(tranche_ids) || tranche_ids.length === 0) {
      throw new ValidationError('tranche_ids is required')
    }
    // Whatever the preview can return, this has to accept: the RPC requires
    // every live tranche, so a book between the two limits could never merge.
    if (tranche_ids.length > MERGE_TRANCHE_LIMIT) throw new ValidationError('tranche_ids is too long')
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
      p_expected_successor_id: cleanExpectedSuccessor,
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
