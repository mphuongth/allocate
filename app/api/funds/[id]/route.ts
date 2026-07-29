import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { validateNavSourceUrl } from '@/lib/scrape-fund-nav'
import { ValidationError, validateAmount } from '@/lib/validation'
import { readJsonBody } from '@/lib/apiBody'

const FUND_TYPES = ['balanced', 'equity', 'debt', 'gold'] as const
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: fund, error } = await supabase
    .from('funds')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !fund) {
    return NextResponse.json({ error: 'Fund not found' }, { status: 404 })
  }

  return NextResponse.json(fund)
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body
  const { name, code, fund_type, nav, nav_source_url, is_dca, dca_monthly_amount_vnd, dca_goal_id } = body

  if (is_dca !== undefined && typeof is_dca !== 'boolean') {
    return NextResponse.json({ error: 'is_dca must be a boolean' }, { status: 400 })
  }

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

  // Validate the NAV source URL (https + exact vendor-host allowlist) before it
  // is stored and later fetched server-side — prevents SSRF.
  let cleanNavUrl: string | null
  try {
    cleanNavUrl = validateNavSourceUrl(nav_source_url)
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const update: Record<string, unknown> = {
    name: name.trim(),
    code: code.trim().toUpperCase(),
    fund_type,
    nav: navNum,
    nav_source_url: cleanNavUrl,
  }
  // DCA fields use partial-update semantics: only written when the caller
  // actually sends is_dca. The Add/Edit form omits them, so a name/NAV edit
  // must preserve the existing DCA config instead of silently wiping it. The
  // DCA toggle/amount/goal handlers always send is_dca, so they're unaffected.
  if (is_dca !== undefined) {
    update.is_dca = is_dca === true
    // Validate by *presence* (not truthiness) so a provided 0 is rejected rather
    // than silently stored as null — a positive, whole (BIGINT) amount, else a
    // 400 instead of a DB CHECK / type error (500).
    let dcaAmount: number | null = null
    if (is_dca === true && dca_monthly_amount_vnd != null && dca_monthly_amount_vnd !== '') {
      try {
        dcaAmount = validateAmount(dca_monthly_amount_vnd, 'dca_monthly_amount_vnd', { positive: true, integer: true })
      } catch (e) {
        if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
        throw e
      }
    }
    update.dca_monthly_amount_vnd = dcaAmount
    // Goal target only applies while DCA is on; cleared otherwise.
    update.dca_goal_id = is_dca === true && dca_goal_id ? dca_goal_id : null
    // A valid-looking UUID isn't proof of ownership: verify the DCA goal is the
    // caller's before linking it (#474).
    if (update.dca_goal_id) {
      const { data: goal } = await supabase
        .from('savings_goals')
        .select('goal_id')
        .eq('goal_id', update.dca_goal_id)
        .eq('user_id', user.id)
        .single()
      if (!goal) return NextResponse.json({ error: "You don't have permission to access this goal." }, { status: 403 })
    }
  }

  // Disabling is a cross-table state change: the fund config and every pending
  // seeded allocation must commit (or roll back) together. The RPC also takes
  // the same row lock used by plan seeding, so a concurrent plan load cannot
  // commit a stale pending row after this cleanup finishes.
  const disablingDca = is_dca === false
  const result = disablingDca
    ? await supabase
        .rpc('disable_fund_dca', {
          p_fund_id: id,
          p_name: update.name,
          p_code: update.code,
          p_fund_type: update.fund_type,
          p_nav: update.nav,
          p_nav_source_url: update.nav_source_url,
        })
        .single()
    : await supabase
        .from('funds')
        .update(update)
        .eq('id', id)
        .eq('user_id', user.id)
        .select()
        .single()

  const { data: fund, error } = result

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Code already exists' }, { status: 409 })
    }
    // Zero rows matched: the regular update path surfaces this as PGRST116 (from
    // .single()), the disable RPC as P0002 (no_data_found). Both mean the fund
    // doesn't exist or isn't the caller's — a 404, not a generic 500, and it
    // avoids disclosing whether a foreign fund exists. (This is why the `if
    // (!fund)` guard below never fires for the update path — .single() reports a
    // zero-row result as an error, not null data.)
    if (error.code === 'P0002' || error.code === 'PGRST116') {
      return NextResponse.json({ error: 'Fund not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to update fund' }, { status: 500 })
  }

  if (!fund) {
    return NextResponse.json({ error: 'Fund not found' }, { status: 404 })
  }

  return NextResponse.json(fund)
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: fund } = await supabase
    .from('funds')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!fund) {
    return NextResponse.json({ error: 'Fund not found' }, { status: 404 })
  }

  const { error } = await supabase.from('funds').delete().eq('id', id).eq('user_id', user.id)

  if (error) {
    // A fund referenced by a monthly-plan allocation is protected by an
    // ON DELETE RESTRICT foreign key (Postgres 23503). Funds drive cash-flow
    // planning, so we hard-block the delete and return a specific, actionable
    // 409 (code: fund_in_use) instead of a generic 500 — the UI tells the user
    // to remove it from the plan first (#1).
    if (error.code === '23503') {
      return NextResponse.json({ error: 'Fund is in use', code: 'fund_in_use' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to delete fund' }, { status: 500 })
  }

  return new NextResponse(null, { status: 204 })
}
