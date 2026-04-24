import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { scrapeFundNav } from '@/lib/scrape-fund-nav'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
