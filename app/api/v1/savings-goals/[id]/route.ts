import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: goal, error } = await supabase
    .from('savings_goals')
    .select('*')
    .eq('goal_id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
  return NextResponse.json(goal)
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { goal_name, description, target_amount, target_date, icon, priority } = body

  if (!goal_name || typeof goal_name !== 'string' || goal_name.trim().length === 0) {
    return NextResponse.json({ error: 'Goal name is required.' }, { status: 400 })
  }

  const targetAmountVal = target_amount != null && target_amount !== '' ? Number(target_amount) : null
  if (targetAmountVal !== null && (isNaN(targetAmountVal) || targetAmountVal <= 0)) {
    return NextResponse.json({ error: 'Goal amount must be a positive number.' }, { status: 400 })
  }

  const VALID_ICONS = ['mountains', 'home', 'shield', 'cart', 'target']
  const VALID_PRIORITIES = ['low', 'med', 'high']

  const { data: goal, error } = await supabase
    .from('savings_goals')
    .update({
      goal_name: goal_name.trim(),
      description: description?.trim() || null,
      target_amount: targetAmountVal,
      target_date: target_date || null,
      icon: VALID_ICONS.includes(icon) ? icon : 'target',
      priority: VALID_PRIORITIES.includes(priority) ? priority : 'med',
      updated_at: new Date().toISOString(),
    })
    .eq('goal_id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error || !goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
  return NextResponse.json(goal)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Count linked transactions before delete (ON DELETE SET NULL handles the nulling)
  const { count } = await supabase
    .from('investment_transactions')
    .select('*', { count: 'exact', head: true })
    .eq('goal_id', id)
    .eq('user_id', user.id)

  const { error } = await supabase
    .from('savings_goals')
    .delete()
    .eq('goal_id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
  return NextResponse.json({ message: `Goal deleted. ${count ?? 0} transactions moved to Unassigned Investments.` })
}
