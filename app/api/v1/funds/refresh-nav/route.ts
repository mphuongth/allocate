import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { fetchFmarketNavIndex, lookupFundNav } from '@/lib/fmarket-nav'

// Bound the user-triggered NAV refresh (#515): rate-limit per user, then read
// every fund's NAV from a single upstream request.
// The rate-limit policy (5 req / 60 s) is hardcoded inside the RPC, not passed
// from here, so a client calling the RPC directly can't weaken it.
const RATE_LIMIT_WINDOW_SECONDS = 60

type FundRow = { id: string; name: string; code: string }
type Result = { id: string; name: string; code: string; nav?: number; updatedAt?: string; error?: string }

export async function POST() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Durable per-user rate limit (atomic fixed window in Postgres). One account
  // must not be able to repeatedly trigger the outbound refresh.
  const { data: rl, error: rlError } = await supabase.rpc('check_nav_refresh_rate_limit')
  const verdict = Array.isArray(rl) ? rl[0] : rl
  if (rlError || !verdict) {
    // Fail CLOSED: if we can't verify the rate limit (RPC error, missing verdict,
    // or the migration not yet applied), refuse rather than let the refresh run
    // uncapped exactly when the DB is unhealthy. Refresh is non-essential, so a
    // 503 the client can retry is the safe default.
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

  // nav_auto_sync is the per-fund opt-in; the NAV itself comes from the Fmarket
  // feed matched on funds.code (see lib/fmarket-nav.ts for why the per-provider
  // scrapers were retired).
  const { data: funds, error: fetchError } = await supabase
    .from('funds')
    .select('id, name, code')
    .eq('user_id', user.id)
    .eq('nav_auto_sync', true)

  if (fetchError) {
    return NextResponse.json({ error: 'Failed to fetch funds' }, { status: 500 })
  }

  if (!funds || funds.length === 0) {
    return NextResponse.json({ results: [] })
  }

  const rows = funds as FundRow[]

  // One request covers every fund, so an upstream failure is total rather than
  // per-fund. Report it against each fund anyway: the client renders per-fund
  // rows, and a 200 with visible errors keeps a provider outage from looking
  // like a broken app.
  let index
  try {
    index = await fetchFmarketNavIndex()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch fund prices'
    return NextResponse.json({
      results: rows.map((f) => ({ id: f.id, name: f.name, code: f.code, error: message })),
    })
  }

  // Group by resolved NAV so funds sharing a price update in one statement,
  // and collect the unmatched ones as per-fund errors.
  const results: Result[] = []
  const byNav = new Map<number, FundRow[]>()
  for (const fund of rows) {
    const nav = lookupFundNav(index, fund.code)
    if (nav === null) {
      results.push({
        id: fund.id,
        name: fund.name,
        code: fund.code,
        error: `No fund matching code "${fund.code}" is listed upstream`,
      })
      continue
    }
    const group = byNav.get(nav) ?? []
    group.push(fund)
    byNav.set(nav, group)
  }

  for (const [nav, group] of byNav) {
    const ids = group.map((f) => f.id)
    const { data: updated, error: updateError } = await supabase
      .from('funds')
      .update({ nav, updated_at: new Date().toISOString() })
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
  }

  return NextResponse.json({ results })
}
