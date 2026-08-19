import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateEnum, validateText, validateUUID, validateYearMonth } from '@/lib/validation'
import { readJsonBody } from '@/lib/apiBody'

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

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body
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

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body

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

  // One statement, one transaction (#687). Counting the linked transactions,
  // refusing parked cash, clearing the dead merge targets and removing the goal
  // used to be four separate requests with nothing holding them together: the
  // cleanup could commit while the delete failed, and consumed merge history
  // would lose the target it recorded while the goal was still there. The
  // function does all of it under the goal's lock; the route authenticates,
  // validates, and maps the answer.
  const { data, error } = await supabase.rpc('delete_savings_goal', { p_goal_id: goalId })

  if (error) {
    const message = error.message ?? ''
    // Cash earmarked to this goal for a merge. The remedy is in the message
    // because the database's own refusal talks about a goal reference, not about
    // a settlement — "Bỏ chờ gộp" releases it, then the goal deletes (#588).
    if (message.startsWith('delete goal: this goal has cash parked')) {
      return NextResponse.json(
        {
          error: 'This goal has cash parked in it for a merge. Release that settlement before deleting the goal.',
          code: 'held_settlement_parked',
        },
        { status: 409 },
      )
    }
    if (message.startsWith('delete goal: goal not found')) {
      return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
    }
    // Anything else is a fault, not a missing goal. Answering 404 for it is the
    // error-vs-not-found conflation of #532/#533 — it sends the user looking for
    // a goal that is sitting right there.
    console.error('delete_savings_goal failed', message)
    return NextResponse.json({ error: 'Failed to delete the goal' }, { status: 500 })
  }

  const n = (data as { moved?: number } | null)?.moved ?? 0
  const txWord = n === 1 ? 'transaction' : 'transactions'
  return NextResponse.json({ message: `Goal deleted. ${n} ${txWord} moved to Unassigned Investments.` })
}
