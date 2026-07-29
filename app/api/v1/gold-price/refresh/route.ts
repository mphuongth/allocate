import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { scrapeGoldPrice } from '@/lib/scrape-gold'

// Mirrors the window hardcoded in check_gold_refresh_rate_limit; used only as
// the Retry-After fallback when the RPC can't tell us a precise one.
const RATE_LIMIT_WINDOW_SECONDS = 60

export async function POST() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Durable per-user rate limit (atomic fixed window in Postgres), checked
  // before the scrape so a refused call costs DOJI nothing (#530).
  const { data: rl, error: rlError } = await supabase.rpc('check_gold_refresh_rate_limit')
  const verdict = Array.isArray(rl) ? rl[0] : rl
  if (rlError || !verdict) {
    // Fail CLOSED: if the limit can't be verified (RPC error, missing verdict, or
    // the migration not yet applied), refuse rather than let the scrape run
    // uncapped exactly when the database is unhealthy. Refresh is non-essential,
    // so a retryable 503 is the safe default.
    console.error('[gold-price refresh] rate-limit check unavailable:', rlError)
    return NextResponse.json(
      { error: 'Rate limit check unavailable. Please try again shortly.' },
      { status: 503, headers: { 'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS) } },
    )
  }
  if (verdict.allowed === false) {
    const retryAfter = verdict.retry_after_seconds ?? RATE_LIMIT_WINDOW_SECONDS
    return NextResponse.json(
      { error: 'Too many refresh requests. Please wait and try again.', retryAfter },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    )
  }

  let price: number
  try {
    price = await scrapeGoldPrice()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Scraping failed'
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  // One statement does the read, the carry-over and the write. Reading the
  // current price separately used to leave a gap on both sides: the read's error
  // was discarded, so a transient failure stored previous = null and erased the
  // comparison point behind a 200; and a concurrent refresh landing in the gap
  // produced a mismatched previous/current pair. The RPC's INSERT … ON CONFLICT
  // DO UPDATE has no read to fail and takes a row lock, so concurrent refreshes
  // serialize into a valid chain (#528).
  const { data, error } = await supabase
    .rpc('refresh_gold_price', { p_price: price })
    .single()

  if (error || !data) {
    console.error('gold-price refresh: atomic refresh failed', error?.message)
    return NextResponse.json({ error: 'Failed to save gold price' }, { status: 500 })
  }

  // The RPC row is returned whole, so previous_price_per_chi reaches the client
  // here too. Nothing consumes it: settingsShared's refreshPrices only inspects
  // res.ok. Deliberate — see #548, option 2, and the column comment in
  // 20260729000001_document_previous_price_intent.sql.
  return NextResponse.json(data)
}
