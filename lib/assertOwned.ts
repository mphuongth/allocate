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
