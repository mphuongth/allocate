import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { scrapeFundNav, normalizeNavUrl } from '@/lib/scrape-fund-nav'
import { mapWithConcurrency } from '@/lib/concurrency'

// Bound the user-triggered NAV refresh fan-out (#515): rate-limit per user,
// de-duplicate by provider URL, and cap outbound scrape concurrency.
// The rate-limit policy (5 req / 60 s) is hardcoded inside the RPC, not passed
// from here, so a client calling the RPC directly can't weaken it.
const RATE_LIMIT_WINDOW_SECONDS = 60
const SCRAPE_CONCURRENCY = 4

type FundRow = { id: string; name: string; code: string; nav_source_url: string | null }

export async function POST() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Durable per-user rate limit (atomic fixed window in Postgres). One account
  // must not be able to repeatedly trigger the whole scrape fan-out.
  const { data: rl, error: rlError } = await supabase.rpc('check_nav_refresh_rate_limit')
  const verdict = Array.isArray(rl) ? rl[0] : rl
  if (rlError || !verdict) {
    // Fail CLOSED: if we can't verify the rate limit (RPC error, missing verdict,
    // or the migration not yet applied), refuse rather than let the scrape fan-out
    // run uncapped exactly when the DB is unhealthy. Refresh is non-essential, so
    // a 503 the client can retry is the safe default.
    console.error('[refresh-nav] rate-limit check unavailable:', rlError)
    return NextResponse.json(
      { error: 'Rate limit check unavailable. Please try again shortly.' },
      { status: 503, headers: { 'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS) } }
    )
  }
  if (verdict.allowed === false) {
    const retryAfter = verdict.retry_after_seconds ?? RATE_LIMIT_WINDOW_SECONDS
    return NextResponse.json(
      { error: 'Too many refresh requests. Please wait and try again.', retryAfter },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    )
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

  // De-duplicate by normalized source URL: many funds can share one provider
  // page, so scrape each distinct URL exactly once and fan the result back to
  // every fund on it. This is what the daily cron already does — the
  // user-triggered path was the one still scraping per-fund.
  const urlToFunds = new Map<string, FundRow[]>()
  for (const fund of funds as FundRow[]) {
    const key = normalizeNavUrl(fund.nav_source_url!)
    const list = urlToFunds.get(key) ?? []
    list.push(fund)
    urlToFunds.set(key, list)
  }

  // Bounded concurrency instead of an unbounded Promise.all over every URL.
  const uniqueUrls = Array.from(urlToFunds.keys())
  const scraped = await mapWithConcurrency(uniqueUrls, SCRAPE_CONCURRENCY, async (url) => ({
    url,
    result: await scrapeFundNav(url),
  }))

  const results: unknown[] = []
  for (const { url, result } of scraped) {
    const group = urlToFunds.get(url)!
    if ('nav' in result) {
      const ids = group.map((f) => f.id)
      const { data: updated, error: updateError } = await supabase
        .from('funds')
        .update({ nav: result.nav, updated_at: new Date().toISOString() })
        .in('id', ids)
        .eq('user_id', user.id)
        .select('id, name, code, nav, updated_at')

      if (updateError || !updated) {
        for (const f of group) {
          results.push({ id: f.id, name: f.name, code: f.code, error: 'Failed to update in database' })
        }
      } else {
        for (const u of updated) {
          results.push({ id: u.id, name: u.name, code: u.code, nav: u.nav, updatedAt: u.updated_at })
        }
      }
    } else {
      for (const f of group) {
        results.push({ id: f.id, name: f.name, code: f.code, error: result.error })
      }
    }
  }

  return NextResponse.json({ results })
}
