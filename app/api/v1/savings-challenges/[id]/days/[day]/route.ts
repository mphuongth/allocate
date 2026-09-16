import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateInteger, validateUUID } from '@/lib/validation'
import { challengeRefusal, isBusinessMonth, loadOwnedChallenge, notCurrentMonth } from '../../../challengeAccess'

// Un-tick a day — "I didn't actually set that aside".
//
// No "has this day arrived" check, unlike the tick: undoing a mistake does not
// require the day to be re-doable, and the whole month stays undoable until it
// ends. That symmetry is what keeps the tier lock honest — the last day a user
// un-ticks hands the tier choice back, which the database allows precisely
// because getting there costs the month's entire progress.

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; day: string }> },
) {
  const { id, day } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let challengeId: string
  let cleanDay: number
  try {
    challengeId = validateUUID(id, 'challenge_id')
    cleanDay = validateInteger(day, 'day', { min: 1, max: 31 })
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const owned = await loadOwnedChallenge(supabase, challengeId, user.id)
  if (!owned.ok) return owned.response
  if (!isBusinessMonth(owned.challenge.year, owned.challenge.month)) return notCurrentMonth()

  // Scoped by challenge_id, and the challenge was just proven to be this user's
  // — so a day of someone else's month matches nothing rather than being
  // deleted. RLS says the same; this is the half that produces a clear answer.
  const { error } = await supabase
    .from('savings_challenge_days')
    .delete()
    .eq('challenge_id', challengeId)
    .eq('day', cleanDay)

  if (error) {
    const refusal = challengeRefusal(error)
    if (refusal) return refusal
    console.error('savings challenge un-tick failed', error.message)
    return NextResponse.json({ error: 'Failed to undo the day' }, { status: 500 })
  }

  // 204 whether or not a row was there: the caller asked for the day to be
  // untouched, and it is.
  return new NextResponse(null, { status: 204 })
}
