import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateEnum, validateText, validateUUID, validateYearMonth } from '@/lib/validation'

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
      cleanTargetDate = validateYearMonth(target_date, 'target_date')
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

// Partial update — only the keys present in the body are changed (unlike PUT,
// which rewrites every column). The dashboard's edit-goal form sends just
// name / target / date and must not reset icon, priority or description.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let goalId: string
  const updates: Record<string, unknown> = {}

  const body = await request.json()

  try {
    goalId = validateUUID(id, 'goal_id')
    if ('goal_name' in body) updates.goal_name = validateText(body.goal_name, 'goal_name')
    if ('description' in body) {
      updates.description = body.description ? validateText(body.description, 'description', { max: 1000 }) : null
    }
    if ('target_amount' in body) {
      if (body.target_amount == null || body.target_amount === '') {
        updates.target_amount = null
      } else {
        const amt = validateAmount(body.target_amount, 'target_amount')
        if (amt <= 0) throw new ValidationError('target_amount must be positive')
        updates.target_amount = amt
      }
    }
    if ('target_date' in body) {
      // Accept YYYY-MM or YYYY-MM-DD; store as YYYY-MM like the rest of the app.
      updates.target_date = body.target_date
        ? validateYearMonth(String(body.target_date).slice(0, 7), 'target_date')
        : null
    }
    if ('icon' in body && body.icon != null && body.icon !== '') {
      updates.icon = validateEnum(body.icon, ['mountains', 'home', 'shield', 'cart', 'target'] as const, 'icon')
    }
    if ('priority' in body && body.priority != null && body.priority !== '') {
      updates.priority = validateEnum(body.priority, ['low', 'med', 'high'] as const, 'priority')
    }
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  updates.updated_at = new Date().toISOString()

  const { data: goal, error } = await supabase
    .from('savings_goals')
    .update(updates)
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
