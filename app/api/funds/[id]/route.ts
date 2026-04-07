import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const FUND_TYPES = ['balanced', 'equity', 'debt', 'gold'] as const

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
  const { name, code, fund_type, nav, nav_source_url, is_dca, dca_monthly_amount_vnd } = body

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

  const { data: fund, error } = await supabase
    .from('funds')
    .update({
      name: name.trim(),
      code: code.trim().toUpperCase(),
      fund_type,
      nav: navNum,
      nav_source_url: typeof nav_source_url === 'string' && nav_source_url.trim() ? nav_source_url.trim() : null,
      is_dca: is_dca === true,
      dca_monthly_amount_vnd: is_dca === true && dca_monthly_amount_vnd ? Number(dca_monthly_amount_vnd) : null,
    })
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
    return NextResponse.json({ error: 'Failed to delete fund' }, { status: 500 })
  }

  return new NextResponse(null, { status: 204 })
}
