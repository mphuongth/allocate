import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { validateNavSourceUrl } from '@/lib/scrape-fund-nav'
import { ValidationError } from '@/lib/validation'

const FUND_TYPES = ['balanced', 'equity', 'debt', 'gold'] as const
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
      dca_monthly_amount_vnd: is_dca === true && dca_monthly_amount_vnd ? Number(dca_monthly_amount_vnd) : null,
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
