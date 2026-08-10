import { NextResponse } from 'next/server'
import { fetchFmarketNavIndex, lookupFundNav } from '@/lib/fmarket-nav'
import { verifyCronAuth } from '@/lib/cron-auth'
import { createSupabaseAdminClient } from '@/lib/supabase-admin'

export async function GET(request: Request) {
  if (!verifyCronAuth(request.headers.get('Authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Built here, not at module scope, so the build never needs the service-role
  // secret (#536).
  const supabaseAdmin = createSupabaseAdminClient()
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  // nav_auto_sync is the per-fund opt-in; the NAV itself comes from the Fmarket
  // feed matched on funds.code (see lib/fmarket-nav.ts).
  const { data: funds, error: fetchError } = await supabaseAdmin
    .from('funds')
    .select('id, code')
    .eq('nav_auto_sync', true)

  if (fetchError) {
    return NextResponse.json({ error: 'Failed to fetch funds' }, { status: 500 })
  }

  if (!funds || funds.length === 0) {
    return NextResponse.json({ updated: 0, failed: 0 })
  }

  // One request prices every fund for every user, so an upstream failure fails
  // the whole run — report it as such rather than as `failed: 0`.
  let index
  try {
    index = await fetchFmarketNavIndex()
  } catch (err) {
    console.error('[cron refresh-navs] upstream fetch failed:', err)
    return NextResponse.json({ updated: 0, failed: funds.length })
  }

  // Group by resolved NAV so every fund sharing a price updates in one
  // statement, across all users.
  const byNav = new Map<number, string[]>()
  let failed = 0
  for (const fund of funds as { id: string; code: string }[]) {
    const nav = lookupFundNav(index, fund.code)
    if (nav === null) {
      failed += 1
      continue
    }
    const ids = byNav.get(nav) ?? []
    ids.push(fund.id)
    byNav.set(nav, ids)
  }

  let updated = 0
  await Promise.all(
    Array.from(byNav.entries()).map(async ([nav, ids]) => {
      const { error } = await supabaseAdmin
        .from('funds')
        .update({ nav, updated_at: new Date().toISOString() })
        .in('id', ids)

      if (error) {
        failed += ids.length
      } else {
        updated += ids.length
      }
    })
  )

  return NextResponse.json({ updated, failed })
}
