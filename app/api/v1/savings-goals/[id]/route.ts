import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateDate, validateEnum, validateText, validateUUID } from '@/lib/validation'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let goalId: string
  try {
    goalId = validateUUID(id, 'goal_id')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: goal, error } = await supabase
    .from('savings_goals')
    .select('*')
    .eq('goal_id', goalId)
    .eq('user_id', user.id)
    .single()

  if (error || !goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
  return NextResponse.json(goal)
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let goalId: string
  let cleanGoalName: string
  let cleanDescription: string | null = null
  let cleanTargetAmount: number | null = null
  let cleanTargetDate: string | null = null
  let cleanIcon: string = 'target'
  let cleanPriority: string = 'med'

  const body = await request.json()
  const { goal_name, description, target_amount, target_date, icon, priority } = body

  try {
    goalId = validateUUID(id, 'goal_id')
    cleanGoalName = validateText(goal_name, 'goal_name')
    if (description != null && description !== '') {
      cleanDescription = validateText(description, 'description', { max: 1000 })
    }
    if (target_amount != null && target_amount !== '') {
      const amt = validateAmount(target_amount, 'target_amount')
      if (amt <= 0) throw new ValidationError('target_amount must be positive')
      cleanTargetAmount = amt
    }
    if (target_date) {
      cleanTargetDate = validateDate(target_date, 'target_date')
    }
    if (icon != null && icon !== '') {
      cleanIcon = validateEnum(icon, ['mountains', 'home', 'shield', 'cart', 'target'] as const, 'icon')
    }
    if (priority != null && priority !== '') {
      cleanPriority = validateEnum(priority, ['low', 'med', 'high'] as const, 'priority')
    }
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: goal, error } = await supabase
    .from('savings_goals')
    .update({
      goal_name: cleanGoalName,
      description: cleanDescription,
      target_amount: cleanTargetAmount,
      target_date: cleanTargetDate,
      icon: cleanIcon,
      priority: cleanPriority,
      updated_at: new Date().toISOString(),
    })
    .eq('goal_id', goalId)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error || !goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
  return NextResponse.json(goal)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let goalId: string
  try {
    goalId = validateUUID(id, 'goal_id')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Count linked transactions before delete (ON DELETE SET NULL handles the nulling)
  const { count } = await supabase
    .from('investment_transactions')
    .select('*', { count: 'exact', head: true })
    .eq('goal_id', goalId)
    .eq('user_id', user.id)

  const { error } = await supabase
    .from('savings_goals')
    .delete()
    .eq('goal_id', goalId)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
  const n = count ?? 0
  const txWord = n === 1 ? 'transaction' : 'transactions'
  return NextResponse.json({ message: `Goal deleted. ${n} ${txWord} moved to Unassigned Investments.` })
}
