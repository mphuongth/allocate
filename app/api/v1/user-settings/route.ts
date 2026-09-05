import { NextResponse, type NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { readJsonBody } from '@/lib/apiBody'
import { ValidationError } from '@/lib/validation'

// The user's planning assumptions. Today that is one field — the inflation rate
// used to project what a goal will cost — and the table is named for the ones
// that come next rather than for this one.
//
// Nothing here is a measurement, and nothing may write it except a user acting
// on this route: an assumption the app quietly updated from a published CPI
// figure would stop being the user's plan. See 20260905000001.

// Deliberately NOT lib/validation's validateRate, which admits -100..1000
// because it validates *interest* rates on deposits and funds. The column takes
// 0..100, and a validator wider than its column turns a typo into a 500.
function validateInflationRate(val: unknown): number | null {
  // Explicit null clears the assumption back to "not chosen". An ABSENT field
  // is not the same request and is refused by the caller — silence must never
  // be read as an instruction to wipe a setting.
  if (val === null) return null
  const n = typeof val === 'number' ? val : typeof val === 'string' && val.trim() !== '' ? Number(val) : NaN
  if (!Number.isFinite(n)) throw new ValidationError('inflation_rate_pct must be a finite number')
  if (n < 0 || n > 100) throw new ValidationError('inflation_rate_pct must be between 0 and 100')
  return n
}

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // maybeSingle(), not single(): every user starts without a row, and single()
  // reports that absence as a PGRST116 *error* — indistinguishable from a real
  // read failure the moment the route starts failing closed on one (#533).
  const { data, error } = await supabase
    .from('user_settings')
    .select('inflation_rate_pct')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    console.error('user-settings: failed to read settings', error.message)
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 })
  }

  // Normalised so the client has one shape to read. `null` here means "not
  // chosen" and is answered with the app default; a stored 0 arrives as 0 and
  // means the user asked for no inflation at all.
  return NextResponse.json({ inflation_rate_pct: data?.inflation_rate_pct ?? null })
}

export async function PUT(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response

  if (!('inflation_rate_pct' in parsed.body)) {
    return NextResponse.json({ error: 'inflation_rate_pct is required' }, { status: 400 })
  }

  let rate: number | null
  try {
    rate = validateInflationRate(parsed.body.inflation_rate_pct)
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  // user_id comes from the session, never from the body — RLS would refuse a
  // foreign id anyway, but the route must not be the thing relying on that.
  const { error } = await supabase
    .from('user_settings')
    .upsert({ user_id: user.id, inflation_rate_pct: rate, updated_at: new Date().toISOString() })

  if (error) {
    console.error('user-settings: failed to save settings', error.message)
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
  }

  return NextResponse.json({ inflation_rate_pct: rate })
}
