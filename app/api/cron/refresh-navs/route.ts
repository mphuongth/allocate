import { NextResponse } from 'next/server'
import { scrapeFundNav } from '@/lib/scrape-fund-nav'
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

  const { data: funds, error: fetchError } = await supabaseAdmin
    .from('funds')
    .select('id, nav_source_url')
    .not('nav_source_url', 'is', null)

  if (fetchError) {
    return NextResponse.json({ error: 'Failed to fetch funds' }, { status: 500 })
  }

  if (!funds || funds.length === 0) {
    return NextResponse.json({ updated: 0, failed: 0 })
  }

  // Group fund IDs by nav_source_url to scrape each URL once
  const urlToFundIds = new Map<string, string[]>()
  for (const fund of funds) {
    const url = fund.nav_source_url as string
    const ids = urlToFundIds.get(url) ?? []
    ids.push(fund.id)
    urlToFundIds.set(url, ids)
  }

  let updated = 0
  let failed = 0

  await Promise.all(
    Array.from(urlToFundIds.entries()).map(async ([url, ids]) => {
      const result = await scrapeFundNav(url)
      if ('error' in result) {
        failed += ids.length
        return
      }

      const { error } = await supabaseAdmin
        .from('funds')
        .update({ nav: result.nav, updated_at: new Date().toISOString() })
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
