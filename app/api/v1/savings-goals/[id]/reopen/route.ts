import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateUUID } from '@/lib/validation'

// Reopen an archived goal (#650) — correcting the archive, not undoing the
// liquidation. The withdrawals stay: the money really did leave, and re-creating
// the holdings would invent transactions no bank ever made. Clearing the snapshot
// puts the goal back on the active lists as the (probably empty) goal it now is.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  // The error is kept, not folded into the same branch as "no row": a database
  // blip answered as "Goal not found" sends the user looking for something that
  // is right there, and hides a condition a retry would clear (#532).
  const { data: goal, error: goalError } = await supabase
    .from('savings_goals')
    .select('goal_id, completed_at')
    .eq('goal_id', goalId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (goalError) {
    console.error('reopen: goal lookup failed', goalError.message)
    return NextResponse.json({ error: 'Failed to load the goal' }, { status: 500 })
  }
  if (!goal) return NextResponse.json({ error: 'Goal not found' }, { status: 404 })
  if (!goal.completed_at) {
    return NextResponse.json(
      { error: 'This goal is already active.', code: 'not_completed' },
      { status: 409 },
    )
  }

  const { data, error } = await supabase.rpc('reopen_savings_goal', { p_goal_id: goalId })
  if (error) {
    console.error('reopen_savings_goal failed', error.message)
    return NextResponse.json({ error: 'Failed to reopen the goal' }, { status: 500 })
  }

  return NextResponse.json({ goal: data })
}
