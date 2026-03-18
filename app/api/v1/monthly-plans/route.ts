import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month')
  const year = searchParams.get('year')

  if (!month || !year) {
    return NextResponse.json({ error: 'month and year are required' }, { status: 400 })
  }

  const { data: plan, error } = await supabase
    .from('monthly_plans')
    .select('*')
    .eq('user_id', user.id)
    .eq('month', parseInt(month))
    .eq('year', parseInt(year))
    .maybeSingle()

  if (error) return NextResponse.json({ error: 'Failed to fetch plan' }, { status: 500 })
  if (!plan) return NextResponse.json({ error: 'Plan not found for this month' }, { status: 404 })
  return NextResponse.json(plan)
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { month, year, salary_vnd } = body

  const monthNum = parseInt(month)
  const yearNum = parseInt(year)
  const salaryNum = Number(salary_vnd)

  if (!month || monthNum < 1 || monthNum > 12) {
    return NextResponse.json({ error: 'Month must be between 1 and 12' }, { status: 400 })
  }
  if (!year || yearNum < 2000) {
    return NextResponse.json({ error: 'Invalid year' }, { status: 400 })
  }
  if (!salary_vnd || isNaN(salaryNum) || salaryNum <= 0) {
    return NextResponse.json({ error: 'Salary must be positive' }, { status: 400 })
  }

  const { data: plan, error } = await supabase
    .from('monthly_plans')
    .insert({ user_id: user.id, month: monthNum, year: yearNum, salary_vnd: salaryNum })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A plan for this month already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to create plan' }, { status: 500 })
  }

  return NextResponse.json(plan, { status: 201 })
}
