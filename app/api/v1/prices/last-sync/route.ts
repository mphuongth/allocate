import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

// Returns the most recent price-sync time for the current user: the latest
// updated_at across their funds (NAV) and gold price settings. Powers the
// Settings → Price sync card's "Last synced: …" line (replaces a hardcoded
// value). Returns { lastSync: null } when the user has no priced data yet.
export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [funds, gold] = await Promise.all([
    supabase
      .from('funds')
      .select('updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('gold_price_settings')
      .select('updated_at')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])

  // Both sources are required to compute a truthful maximum. Skipping a failed
  // one silently reports the surviving source's older timestamp — or "never
  // synced" — as the answer, which reads as a stale/absent sync rather than as
  // the outage it is (#533). Both queries use maybeSingle(), so a user who owns
  // no funds or has no gold settings is `data: null, error: null` and still gets
  // a legitimate 200.
  if (funds.error || gold.error) {
    console.error(
      'prices/last-sync: failed to read —',
      [
        funds.error && `funds: ${funds.error.message}`,
        gold.error && `gold_price_settings: ${gold.error.message}`,
      ]
        .filter(Boolean)
        .join('; '),
    )
    return NextResponse.json({ error: 'Failed to fetch last sync time' }, { status: 500 })
  }

  const times = [funds.data?.updated_at, gold.data?.updated_at].filter(Boolean) as string[]
  const lastSync = times.length
    ? times.reduce((a, b) => (new Date(a) > new Date(b) ? a : b))
    : null

  return NextResponse.json({ lastSync })
}
