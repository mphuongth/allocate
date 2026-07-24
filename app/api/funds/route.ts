import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { validateNavSourceUrl } from '@/lib/scrape-fund-nav'
import { ValidationError, validateAmount } from '@/lib/validation'

const FUND_TYPES = ['balanced', 'equity', 'debt', 'gold'] as const
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

  const body = await request.json()
  const { name, code, fund_type, nav, nav_source_url, is_dca, dca_monthly_amount_vnd, dca_goal_id } = body

  // Validate required fields
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }
  if (name.trim().length > 255) {
    return NextResponse.json({ error: 'Name must be 255 characters or less' }, { status: 400 })
  }
  if (!code || typeof code !== 'string' || code.trim().length === 0) {
    return NextResponse.json({ error: 'Code is required' }, { status: 400 })
  }
  if (code.trim().length > 50) {
    return NextResponse.json({ error: 'Code must be 50 characters or less' }, { status: 400 })
  }
  if (!fund_type || !FUND_TYPES.includes(fund_type)) {
    return NextResponse.json({ error: 'Fund type is required' }, { status: 400 })
  }
  const navNum = Number(nav)
  // Number('Infinity') is Infinity and would slip past a bare `< 0.01` check —
  // require a finite value so it can't reach the DB numeric column.
  if (!Number.isFinite(navNum) || navNum < 0.01) {
    return NextResponse.json({ error: 'NAV must be greater than 0' }, { status: 400 })
  }
  if (dca_goal_id != null && dca_goal_id !== '' && (typeof dca_goal_id !== 'string' || !UUID_RE.test(dca_goal_id))) {
    return NextResponse.json({ error: 'Invalid goal' }, { status: 400 })
  }
  // DCA amount is only stored when DCA is on. Validate by *presence* (not
  // truthiness) so a provided 0 is rejected rather than silently stored as null
  // — a positive, whole (BIGINT) amount, else a 400 instead of a DB CHECK / type
  // error (500). Absent leaves it null (DCA on, amount not yet set).
  let dcaAmount: number | null = null
  if (is_dca === true && dca_monthly_amount_vnd != null && dca_monthly_amount_vnd !== '') {
    try {
      dcaAmount = validateAmount(dca_monthly_amount_vnd, 'dca_monthly_amount_vnd', { positive: true, integer: true })
    } catch (e) {
      if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
      throw e
    }
  }
  // Validate the NAV source URL (https + exact vendor-host allowlist) before it
  // is stored and later fetched server-side — prevents SSRF.
  let cleanNavUrl: string | null
  try {
    cleanNavUrl = validateNavSourceUrl(nav_source_url)
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  // A valid-looking UUID isn't proof of ownership: verify the DCA goal is the
  // caller's before linking it, so a known foreign goal_id can't be attached (#474).
  if (is_dca === true && dca_goal_id) {
    const { data: goal } = await supabase
      .from('savings_goals')
      .select('goal_id')
      .eq('goal_id', dca_goal_id)
      .eq('user_id', user.id)
      .single()
    if (!goal) return NextResponse.json({ error: "You don't have permission to access this goal." }, { status: 403 })
  }

  const { data: fund, error } = await supabase
    .from('funds')
    .insert({
      user_id: user.id,
      name: name.trim(),
      code: code.trim().toUpperCase(),
      fund_type,
      nav: navNum,
      nav_source_url: cleanNavUrl,
      is_dca: is_dca === true,
      dca_monthly_amount_vnd: dcaAmount,
      // Goal target only applies while DCA is on; cleared otherwise.
      dca_goal_id: is_dca === true && dca_goal_id ? dca_goal_id : null,
    })
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
