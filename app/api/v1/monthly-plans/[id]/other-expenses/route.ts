import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

async function getPlanForUser(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, planId: string, userId: string) {
  const { data } = await supabase
    .from('monthly_plans')
    .select('id')
    .eq('id', planId)
    .eq('user_id', userId)
    .single()
  return data
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const plan = await getPlanForUser(supabase, id, user.id)
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('plan_other_expenses')
    .select('id, description, amount_vnd, created_at')
    .eq('plan_id', id)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const plan = await getPlanForUser(supabase, id, user.id)
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  const body = await req.json()
  const { description, amount_vnd } = body

  if (!description || !description.trim()) {
    return NextResponse.json({ error: 'Mô tả là bắt buộc' }, { status: 400 })
  }
  const amountNum = Number(amount_vnd)
  if (!amount_vnd || isNaN(amountNum) || amountNum <= 0) {
    return NextResponse.json({ error: 'Số tiền phải dương' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('plan_other_expenses')
    .insert({ plan_id: id, description: description.trim(), amount_vnd: amountNum })
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Failed to create' }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
