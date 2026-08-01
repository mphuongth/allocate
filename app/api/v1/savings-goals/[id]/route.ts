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

  // Count linked transactions before delete (ON DELETE SET NULL handles the nulling)
  const { count } = await supabase
    .from('investment_transactions')
    .select('*', { count: 'exact', head: true })
    .eq('goal_id', goalId)
    .eq('user_id', user.id)

  // Cash parked in this goal for a merge (#588). The database refuses the delete
  // either way — merge_target_goal_id has no foreign key, so it would be left
  // pointing at a goal that no longer exists — but it refuses through the #525
  // ownership trigger, whose message is about a goal reference, not about a
  // settlement. Asking first is what turns that into an answer the user can act
  // on: 404 "Goal not found" describes the wrong thing entirely, since the goal is
  // very much there.
  const { data: parked } = await supabase
    .from('investment_transactions')
    .select('transaction_id')
    .eq('user_id', user.id)
    .eq('held_for_merge', true)
    .is('consumed_by_inv_id', null)
    .or(`merge_target_goal_id.eq.${goalId},goal_id.eq.${goalId}`)
    .limit(1)
    .maybeSingle()

  if (parked) {
    return NextResponse.json(
      {
        error: 'This goal has cash parked in it for a merge. Release that settlement before deleting the goal.',
        code: 'held_settlement_parked',
      },
      { status: 409 },
    )
  }

  // Settlements whose merge is already DONE are history, and the goal should not
  // be stuck behind them — but merge_target_goal_id has no foreign key, so the
  // deletion leaves it pointing at nothing and the #525 ownership trigger then
  // refuses the very update the deletion depends on. Adding the missing FK does
  // not help: goal_id and merge_target_goal_id are separate referential actions on
  // the same row, and whichever runs first leaves the other dangling. Clearing it
  // here is deterministic. Safe because the pool skips consumed rows entirely —
  // for them the target is dead metadata.
  await supabase
    .from('investment_transactions')
    .update({ merge_target_goal_id: null })
    .eq('user_id', user.id)
    .eq('held_for_merge', true)
    .not('consumed_by_inv_id', 'is', null)
    .eq('merge_target_goal_id', goalId)

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
