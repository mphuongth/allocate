import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: plan, error } = await supabase
    .from('monthly_plans')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  return NextResponse.json(plan)
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const salaryNum = Number(body.salary_vnd)

  if (!body.salary_vnd || isNaN(salaryNum) || salaryNum <= 0) {
    return NextResponse.json({ error: 'Salary must be positive' }, { status: 400 })
  }

  const { data: plan, error } = await supabase
    .from('monthly_plans')
    .update({ salary_vnd: salaryNum, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error || !plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  return NextResponse.json(plan)
}
