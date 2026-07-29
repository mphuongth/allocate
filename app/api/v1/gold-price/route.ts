import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // maybeSingle(), not single(): a user who has never set a gold price is an
  // expected absence, and single() reports that as a PGRST116 *error* — which
  // would be indistinguishable from a real read failure the moment we start
  // failing closed on errors. With maybeSingle a missing row is `data: null,
  // error: null`, so `error` means only one thing (#533).
  // previous_price_per_chi is returned but nothing renders it. The only client,
  // useGoalDetailData, takes price_per_chi and drops the rest — there is no gold
  // price card in the app; the price is a valuation input, not a displayed quote.
  // That is a decision, not an oversight (#548, option 2): the column is kept so
  // a change-since-last-sync indicator stays possible, and the route keeps asking
  // for it so the field is one edit away from being usable. Removing it from this
  // select is the cheapest way to silently break that — hence the guard in
  // __tests__/route.test.ts pinning the request rather than the response.
  const { data, error } = await supabase
    .from('gold_price_settings')
    .select('price_per_chi, previous_price_per_chi, updated_at')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    console.error('gold-price: failed to read settings', error.message)
    return NextResponse.json({ error: 'Failed to fetch gold price' }, { status: 500 })
  }

  return NextResponse.json(data ?? null)
}
