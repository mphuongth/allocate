import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

// Guard a foreign-key reference: does `id` name a row in `table` owned by
// `userId`? Returns the response to send when it doesn't, or null to proceed.
//
// The database triggers added in #525 are the authoritative guard — they hold
// for service-role writes and any endpoint that forgets to ask. But a trigger
// fires mid-write, so on its own a caller sees a 500 for what is really a bad
// request. This is the front half, so the route can say 403 and mean it.
//
// Returning the response rather than a boolean is deliberate: the failure has
// two distinct shapes and a boolean can only carry one. A lookup that ERRORS is
// not a foreign row — reporting 403 for a database outage tells the client (and
// whoever is paging) that they lack permission, when the truthful answer is
// "try again". Conflating an error with an empty result is the exact habit
// #533 / #529 / #532 removed from the read endpoints; a new helper shouldn't
// reintroduce it.
//
// The lookup is scoped by user_id, so a genuinely foreign row reads as "not
// found" and the 403 leaks nothing about whether that id exists.
/**
 * Guard the OTHER half of a goal reference: the goal is the caller's, but has it
 * been finished (#650)?
 *
 * A completed goal is an archive. New money must not land in one — it would sit
 * under a frozen 100% and never appear on the card. The database refuses it
 * (enforce_goal_not_completed), and that trigger is the authoritative guard; this
 * is the front half, so the caller reads "reopen it first" instead of a 500 from
 * a write that was already doomed.
 *
 * Returns null when the goal is active OR not visible to this user — a foreign
 * goal is the ownership check's refusal to make, and it runs first.
 */
export async function archivedGoalError(
  supabase: SupabaseClient,
  goalId: string,
  userId: string,
): Promise<NextResponse | null> {
  const { data, error } = await supabase
    .from('savings_goals')
    .select('completed_at')
    .eq('goal_id', goalId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('completed-goal check failed', error.message)
    return NextResponse.json({ error: 'Failed to verify permissions' }, { status: 500 })
  }
  if (data?.completed_at) {
    return NextResponse.json(
      { error: 'This goal has been finished, so it takes no new money. Reopen it first.', code: 'goal_completed' },
      { status: 409 },
    )
  }
  return null
}

/**
 * The BACK half: the database's own refusal, turned into an answer (#650).
 *
 * Every completed-goal guard raises with this prefix, and the routes that reach
 * the ledger without asking first would otherwise report it as whatever their
 * catch-all says — "Failed to create investment" (a 500, for a valid request) or,
 * worse, "Transaction not found" (a 404, about a row sitting right there). The
 * refusal is correct; only the story told about it was wrong.
 *
 * Returns null for any other error, so a caller can chain it ahead of its own
 * handling without swallowing anything.
 */
export function completedGoalError(error: { message?: string } | null | undefined): NextResponse | null {
  const message = error?.message ?? ''
  if (!message.startsWith('completed goal: ')) return null
  return NextResponse.json(
    { error: message.slice('completed goal: '.length), code: 'goal_completed' },
    { status: 409 },
  )
}

export async function ownershipError(
  supabase: SupabaseClient,
  table: string,
  pkColumn: string,
  id: string,
  userId: string,
  label: string,
): Promise<NextResponse | null> {
  const { data, error } = await supabase
    .from(table)
    .select(pkColumn)
    .eq(pkColumn, id)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error(`ownership check failed for ${table}.${pkColumn}`, error.message)
    return NextResponse.json({ error: 'Failed to verify permissions' }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: `You don't have permission to access this ${label}.` }, { status: 403 })
  }
  return null
}
