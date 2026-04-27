import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { scrapeFundNav } from '@/lib/scrape-fund-nav'

export async function POST() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch all funds that have a nav_source_url
  const { data: funds, error: fetchError } = await supabase
    .from('funds')
    .select('id, name, code, nav_source_url')
    .eq('user_id', user.id)
    .not('nav_source_url', 'is', null)

  if (fetchError) {
    return NextResponse.json({ error: 'Failed to fetch funds' }, { status: 500 })
  }

  if (!funds || funds.length === 0) {
    return NextResponse.json({ results: [] })
  }

  // Scrape NAV for each fund in parallel
  const scrapeResults = await Promise.all(
    funds.map(async (fund) => {
      const result = await scrapeFundNav(fund.nav_source_url!)
      return { fund, result }
    })
  )

  // Batch update successful ones
  const results = []
  for (const { fund, result } of scrapeResults) {
    if ('nav' in result) {
      const { data: updated, error: updateError } = await supabase
        .from('funds')
        .update({ nav: result.nav, updated_at: new Date().toISOString() })
        .eq('id', fund.id)
        .eq('user_id', user.id)
        .select('id, name, code, nav, updated_at')
        .single()

      if (updateError || !updated) {
        results.push({ id: fund.id, name: fund.name, code: fund.code, error: 'Failed to update in database' })
      } else {
        results.push({ id: updated.id, name: updated.name, code: updated.code, nav: updated.nav, updatedAt: updated.updated_at })
      }
    } else {
      results.push({ id: fund.id, name: fund.name, code: fund.code, error: result.error })
    }
  }

  return NextResponse.json({ results })
}
