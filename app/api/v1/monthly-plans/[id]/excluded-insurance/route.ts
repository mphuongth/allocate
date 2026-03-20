import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: plan } = await supabase.from('monthly_plans').select('id').eq('id', id).eq('user_id', user.id).single()
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('plan_excluded_insurance_members')
    .select('id, member_id')
    .eq('plan_id', id)

  if (error) return NextResponse.json({ error: 'Failed to fetch exclusions' }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: plan } = await supabase.from('monthly_plans').select('id').eq('user_id', user.id).eq('id', id).single()
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  const { member_id } = await request.json()
  if (!member_id) return NextResponse.json({ error: 'member_id is required' }, { status: 400 })

  const { data, error } = await supabase
    .from('plan_excluded_insurance_members')
    .upsert({ plan_id: id, member_id }, { onConflict: 'plan_id,member_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Failed to exclude member' }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
