import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { readJsonBody } from '@/lib/apiBody'
import { parseFundPayload, dcaGoalOwnershipError, unpriceableFundCodeError } from '@/lib/fundPayload'
import { priceAutoSyncFunds } from '@/lib/fundPricing'

// Canonical funds-list contract (#470): GET /api/funds → `{ funds: Fund[] }`,
// each a full fund row (`select('*')`), ordered by name. Every consumer reads
// `data.funds` — the fund library (useFundsData), the ledger filter
// (TransactionLedgerSheet), and the add-transaction sheet. The old
// `GET /api/v1/funds` (a bare array with a smaller field set) was removed; its
// only consumer now uses this contract.
export async function GET() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: funds, error } = await supabase
    .from('funds')
    .select('*')
    .eq('user_id', user.id)
    .order('name', { ascending: true })

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch funds' }, { status: 500 })
  }

  return NextResponse.json({ funds })
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response

  // Create mode always yields DCA fields — defaults when the caller sends none.
  const payload = parseFundPayload(parsed.body, 'create')
  if (!payload.ok) return payload.response
  const { fund: fields, dca } = payload

  const unpriceable = await unpriceableFundCodeError(fields)
  if (unpriceable) return unpriceable

  // A fund that prices itself may be created without a price: the number the
  // form would have asked for is the one this fetches, so demanding it up front
  // only sends the user off to look it up. Resolved here rather than left to the
  // nightly refresh — a fund inserted at zero has nothing to show until then,
  // and the DB's `nav >= 0.01` check refuses it anyway.
  if (fields.nav == null) {
    const [outcome] = [...(await priceAutoSyncFunds([fields])).values()]
    if (!outcome || !outcome.ok) {
      // Fails CLOSED, unlike the code check just above. An unverifiable code is
      // no reason to block a save; an unobtainable price leaves nothing to save.
      return NextResponse.json(
        { error: 'Could not fetch a price for this fund right now. Enter one, and automatic updates will take over.' },
        { status: 400 },
      )
    }
    fields.nav = outcome.price
  }

  if (dca.is_dca && dca.dca_goal_id) {
    const denied = await dcaGoalOwnershipError(supabase, dca.dca_goal_id, user.id)
    if (denied) return denied
  }

  const { data: fund, error } = await supabase
    .from('funds')
    .insert({ user_id: user.id, ...fields, ...dca })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Code already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to create fund' }, { status: 500 })
  }

  return NextResponse.json(fund, { status: 201 })
}
