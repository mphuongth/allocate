import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateInteger, validateUUID } from '@/lib/validation'
import { readJsonBody } from '@/lib/apiBody'
import { challengeDayAmount } from '@/lib/savingsChallenge'
import { todayIso } from '@/lib/dates'
import { challengeRefusal, isBusinessMonth, loadOwnedChallenge, notCurrentMonth } from '../../challengeAccess'

// Tick a day off — "I set this much aside today".
//
// The amount is DERIVED here, from the challenge's own year/month/step. The
// client never sends one: a route that accepted `amount_vnd` would be leaning on
// the trigger to catch a lie, and a trigger is a last line rather than the
// contract. Both sides compute it from lib/savingsChallenge, which mirrors
// public.savings_challenge_day_amount, so all three agree by construction.

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response

  let challengeId: string
  let day: number
  try {
    challengeId = validateUUID(id, 'challenge_id')
    // 1..31 is the calendar; whether THIS month has that day is checked below,
    // once the challenge says which month it is.
    day = validateInteger(parsed.body.day, 'day', { min: 1, max: 31 })
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const owned = await loadOwnedChallenge(supabase, challengeId, user.id)
  if (!owned.ok) return owned.response
  const { year, month, unit_vnd: unitVnd } = owned.challenge
  if (!isBusinessMonth(year, month)) return notCurrentMonth()

  const amountVnd = challengeDayAmount(year, month, unitVnd, day)
  // 0 means the month has no such day — the same answer the database's trigger
  // arrives at, reached here so the caller reads the calendar rather than a
  // constraint violation.
  if (amountVnd <= 0) {
    return NextResponse.json(
      { error: `This month has no day ${day}.`, code: 'challenge_day_absent' },
      { status: 409 },
    )
  }

  // A day that has not happened yet. Derived through lib/dates like every other
  // "today" in the app: between 00:00 and 06:59 Vietnam time the UTC date is
  // still yesterday, which would refuse the very day the user is ticking (#591).
  const today = Number(todayIso().slice(8, 10))
  if (day > today) {
    return NextResponse.json(
      { error: 'That day has not arrived yet.', code: 'challenge_day_future' },
      { status: 409 },
    )
  }

  const { data, error } = await supabase
    .from('savings_challenge_days')
    .insert({ challenge_id: challengeId, day, amount_vnd: amountVnd })
    .select('day, amount_vnd')
    .single()

  if (error) {
    // Already ticked. A double-tap on a checkbox is not a mistake worth
    // reporting — the end state the caller asked for is the one they have — so
    // this answers 200 rather than 409, and the UI needs no special case.
    if (error.code === '23505') {
      return NextResponse.json({ day, amount_vnd: amountVnd })
    }
    const refusal = challengeRefusal(error)
    if (refusal) return refusal
    console.error('savings challenge tick failed', error.message)
    return NextResponse.json({ error: 'Failed to record the day' }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

