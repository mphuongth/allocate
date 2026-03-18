import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify plan belongs to user
  const { data: plan } = await supabase.from('monthly_plans').select('id').eq('id', id).eq('user_id', user.id).single()
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('fund_investments')
    .select('*, funds(name, nav), savings_goals(goal_name)')
    .eq('plan_id', id)
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: 'Failed to fetch investments' }, { status: 500 })
  return NextResponse.json(data)
}
