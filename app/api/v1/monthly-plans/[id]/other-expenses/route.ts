import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateText, validateUUID } from '@/lib/validation'

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

  let planId: string
  try {
    planId = validateUUID(id, 'plan_id')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const plan = await getPlanForUser(supabase, planId, user.id)
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('plan_other_expenses')
    .select('id, description, amount_vnd, created_at')
    .eq('plan_id', planId)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const { description, amount_vnd } = body

  let planId: string
  let cleanDescription: string
  let cleanAmount: number
  try {
    planId = validateUUID(id, 'plan_id')
    if (!description || (typeof description === 'string' && !description.trim())) {
      throw new ValidationError('Mô tả là bắt buộc')
    }
    cleanDescription = validateText(description, 'description', { max: 500 })
    cleanAmount = validateAmount(amount_vnd, 'amount_vnd')
    if (cleanAmount <= 0) throw new ValidationError('Số tiền phải dương')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const plan = await getPlanForUser(supabase, planId, user.id)
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('plan_other_expenses')
    .insert({ plan_id: planId, description: cleanDescription, amount_vnd: cleanAmount })
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Failed to create' }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
