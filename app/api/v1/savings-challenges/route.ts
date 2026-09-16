import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateInteger } from '@/lib/validation'
import { readJsonBody } from '@/lib/apiBody'
import { isChallengeTier } from '@/lib/savingsChallenge'
import { CHALLENGE_COLUMNS, isBusinessMonth, notCurrentMonth } from './challengeAccess'

// A month's savings challenge: read one, or start one.
//
// Keyed by (year, month) rather than by a plan id — the challenge is a tracker
// that stands on its own, and a month with no monthly_plan can still run one.

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)

  let year: number
  let month: number
  try {
    year = validateInteger(searchParams.get('year'), 'year', { min: 2000, max: 2200 })
    month = validateInteger(searchParams.get('month'), 'month', { min: 1, max: 12 })
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const { data: challenge, error } = await supabase
    .from('savings_challenges')
    .select(CHALLENGE_COLUMNS)
    .eq('user_id', user.id)
    .eq('year', year)
    .eq('month', month)
    .maybeSingle()

  // A failed read is not an untouched month. `challenge: null` is what makes the
  // UI offer the tier picker, so degrading into it would invite the user to
  // start a month they have already started — and the 409 on submit would be the
  // first they heard of the error (#533).
  if (error) {
    console.error('savings challenge read failed', error.message)
    return NextResponse.json({ error: 'Failed to load the challenge' }, { status: 500 })
  }
  if (!challenge) return NextResponse.json({ challenge: null, days: [] })

  const { data: days, error: daysError } = await supabase
    .from('savings_challenge_days')
    .select('day')
    .eq('challenge_id', challenge.challenge_id)

  // Same rule, and this one is sharper: an empty day list reads as "nothing
  // saved yet" AND unlocks the tier, so a swallowed error would both understate
  // the month and offer a change the database is about to refuse.
  if (daysError) {
    console.error('savings challenge days read failed', daysError.message)
    return NextResponse.json({ error: 'Failed to load the challenge' }, { status: 500 })
  }

  return NextResponse.json({
    challenge,
    days: (days ?? []).map((d: { day: number }) => d.day),
  })
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const { year, month, tier } = parsed.body

  let cleanYear: number
  let cleanMonth: number
  try {
    cleanYear = validateInteger(year, 'year', { min: 2000, max: 2200 })
    cleanMonth = validateInteger(month, 'month', { min: 1, max: 12 })
    // The tier is the product decision, not a number in a range — naming the
    // three is what keeps a "4" from reaching the database's own CHECK and
    // coming back as a 500.
    if (!isChallengeTier(tier)) throw new ValidationError('tier must be 1, 2 or 3')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  if (!isBusinessMonth(cleanYear, cleanMonth)) return notCurrentMonth()

  const { data, error } = await supabase
    .from('savings_challenges')
    .insert({ user_id: user.id, year: cleanYear, month: cleanMonth, tier })
    .select(CHALLENGE_COLUMNS)
    .single()

  if (error) {
    // The (user_id, year, month) unique constraint. Two tabs, or a double
    // submit — the month is already under way, which is a state the caller can
    // act on (re-read it) rather than a failure.
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'This month already has a savings challenge.', code: 'challenge_exists' },
        { status: 409 },
      )
    }
    console.error('savings challenge create failed', error.message)
    return NextResponse.json({ error: 'Failed to start the challenge' }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}
