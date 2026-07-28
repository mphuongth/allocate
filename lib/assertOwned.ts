import type { SupabaseClient } from '@supabase/supabase-js'

// Does `id` name a row in `table` owned by `userId`?
//
// The database triggers added in #525 are the authoritative guard — they hold for
// service-role writes and any endpoint that forgets to ask. But a trigger fires
// after the request is already committed to writing, so on its own a caller sees
// a 500 for what is really a bad request. This is the front half: a cheap lookup
// so the route can say 403 and mean it.
//
// Scoped by user_id, so a foreign row reads as "not found" and the answer leaks
// nothing about whether that id exists.
export async function isOwnedBy(
  supabase: SupabaseClient,
  table: string,
  pkColumn: string,
  id: string,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from(table)
    .select(pkColumn)
    .eq(pkColumn, id)
    .eq('user_id', userId)
    .maybeSingle()
  return data !== null
}
