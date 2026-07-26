import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Service-role Supabase client for the cron routes — the only paths that
// legitimately bypass RLS to write across every user's rows.
//
// Deliberately a function, never a module-scope constant. Next evaluates every
// route module while collecting page data, so a top-level createClient() made
// `npm run build` fail with supabase-js's raw `supabaseKey is required.` on any
// machine without the production secret (#536). A build should not need a
// runtime capability; creating the client inside the handler — after cron
// authorization — keeps the secret a request-time concern.
//
// Reads process.env on every call (no caching) so the check reflects the
// environment the request actually runs in, and returns null rather than
// throwing so callers fail closed with a controlled 500. The missing variable is
// logged server-side only: which secret an environment lacks is not something to
// hand back to a caller.
export function createSupabaseAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    console.error(
      'supabase-admin: missing runtime configuration —',
      [!url && 'NEXT_PUBLIC_SUPABASE_URL', !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY']
        .filter(Boolean)
        .join(', '),
    )
    return null
  }

  return createClient(url, serviceRoleKey)
}
