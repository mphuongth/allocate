import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { validateNavSourceUrl } from '@/lib/scrape-fund-nav'
import { ValidationError } from '@/lib/validation'

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

  const body = await request.json()
  const { name, code, fund_type, nav, nav_source_url, is_dca, dca_monthly_amount_vnd, dca_goal_id } = body

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
  if (!nav || isNaN(navNum) || navNum < 0.01) {
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
    update.dca_monthly_amount_vnd = is_dca === true && dca_monthly_amount_vnd ? Number(dca_monthly_amount_vnd) : null
    // Goal target only applies while DCA is on; cleared otherwise.
    update.dca_goal_id = is_dca === true && dca_goal_id ? dca_goal_id : null
  }

  const { data: fund, error } = await supabase
    .from('funds')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Code already exists' }, { status: 409 })
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
