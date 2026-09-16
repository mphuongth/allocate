// Shared front-half guards for the savings-challenge routes.
//
// The database owns the real rules (20260916000001): the tier freezes at the
// first tick, an amount has to match the schedule, a day has to exist in its
// month. Those are statements about rows that already exist, so they cannot be
// settled correctly anywhere else. But a trigger fires mid-write, and on its own
// the caller reads a 500 for what is really a refusal it could act on — so each
// helper here turns one of those refusals into an answer, the way
// completedGoalError does for a finished goal (#650).

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { businessYearMonth } from '@/lib/dates'
import type { ChallengeTier } from '@/lib/savingsChallenge'

export type ChallengeRow = {
  challenge_id: string
  year: number
  month: number
  tier: ChallengeTier
}

export const CHALLENGE_COLUMNS = 'challenge_id, year, month, tier'

/**
 * The database's own refusal, turned into an answer.
 *
 * Every guard in the migration raises with this prefix, and the message is
 * already written for a person — the route should pass it along rather than
 * replace it with "Failed to update challenge", which would hide the one thing
 * the user needs to know (the tier is locked because they have started ticking).
 *
 * 409, not 400: the request is well-formed, and it is the state of the month
 * that refuses it. Returns null for anything else, so it chains ahead of a
 * route's own error handling without swallowing it.
 */
export function challengeRefusal(error: { message?: string } | null | undefined): NextResponse | null {
  const message = error?.message ?? ''
  if (!message.startsWith('savings challenge: ')) return null
  return NextResponse.json(
    { error: message.slice('savings challenge: '.length), code: 'challenge_locked' },
    { status: 409 },
  )
}

/**
 * Is this the business month?
 *
 * Everything that WRITES is limited to it. A past month is history — letting
 * yesterday's month keep changing would mean a "saved" figure that is still
 * moving after the month it describes has ended — and a future month has not
 * begun, so a challenge started there would have no tickable day in it at all.
 *
 * This one rule is deliberately NOT in the database. Every invariant that lives
 * there is timeless: it holds for a row whenever you look at it. "Is this the
 * current month" stops being true while the row sits still, which makes it a
 * rule about the request rather than about the data — and a trigger enforcing it
 * would also refuse the backfill or repair that a future migration is entitled
 * to make. Nothing it guards can corrupt a month: a day ticked outside the
 * window is still a real day of a real month at the right amount.
 */
export function isBusinessMonth(year: number, month: number, now: Date = new Date()): boolean {
  const business = businessYearMonth(now)
  return business.year === year && business.month === month
}

export function notCurrentMonth(): NextResponse {
  return NextResponse.json(
    {
      error: 'A savings challenge can only be changed during the month it is for.',
      code: 'challenge_month_closed',
    },
    { status: 409 },
  )
}

/**
 * Load the challenge this request names, or the response to send instead.
 *
 * Scoped by user_id, so a challenge belonging to someone else reads as "not
 * found" and the 404 leaks nothing about whether that id exists. A lookup that
 * ERRORS is not a missing row — reporting 404 for a database outage tells the
 * caller to stop retrying something that would have worked.
 */
export async function loadOwnedChallenge(
  supabase: SupabaseClient,
  challengeId: string,
  userId: string,
): Promise<{ ok: true; challenge: ChallengeRow } | { ok: false; response: NextResponse }> {
  const { data, error } = await supabase
    .from('savings_challenges')
    .select(CHALLENGE_COLUMNS)
    .eq('challenge_id', challengeId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.error('savings challenge lookup failed', error.message)
    return { ok: false, response: NextResponse.json({ error: 'Failed to load the challenge' }, { status: 500 }) }
  }
  if (!data) {
    return { ok: false, response: NextResponse.json({ error: 'Challenge not found' }, { status: 404 }) }
  }
  return { ok: true, challenge: data as unknown as ChallengeRow }
}
