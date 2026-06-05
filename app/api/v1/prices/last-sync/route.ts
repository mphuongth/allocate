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

  const times = [funds.data?.updated_at, gold.data?.updated_at].filter(Boolean) as string[]
  const lastSync = times.length
    ? times.reduce((a, b) => (new Date(a) > new Date(b) ? a : b))
    : null

  return NextResponse.json({ lastSync })
}
