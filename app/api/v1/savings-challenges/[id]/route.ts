import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateUUID } from '@/lib/validation'
import { readJsonBody } from '@/lib/apiBody'
import { isChallengeTier } from '@/lib/savingsChallenge'
import {
  CHALLENGE_COLUMNS, challengeRefusal, isBusinessMonth, loadOwnedChallenge, notCurrentMonth,
} from '../challengeAccess'

// Change a month's tier, or abandon the month.
//
// Both are only possible before the first day is ticked; the database holds that
// line (20260916000001) and these handlers relay its refusal. The check is NOT
// duplicated here — reading "are there days yet" and then writing is two
// statements, and two requests can both pass the read.

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const { tier } = parsed.body

  let challengeId: string
  try {
    challengeId = validateUUID(id, 'challenge_id')
    if (!isChallengeTier(tier)) throw new ValidationError('tier must be 1, 2 or 3')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const owned = await loadOwnedChallenge(supabase, challengeId, user.id)
  if (!owned.ok) return owned.response
  if (!isBusinessMonth(owned.challenge.year, owned.challenge.month)) return notCurrentMonth()

  const { data, error } = await supabase
    .from('savings_challenges')
    .update({ tier, updated_at: new Date().toISOString() })
    .eq('challenge_id', challengeId)
    .eq('user_id', user.id)
    .select(CHALLENGE_COLUMNS)
    .single()

  if (error) {
    const refusal = challengeRefusal(error)
    if (refusal) return refusal
    console.error('savings challenge re-tier failed', error.message)
    return NextResponse.json({ error: 'Failed to change the tier' }, { status: 500 })
  }

  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let challengeId: string
  try {
    challengeId = validateUUID(id, 'challenge_id')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const owned = await loadOwnedChallenge(supabase, challengeId, user.id)
  if (!owned.ok) return owned.response
  if (!isBusinessMonth(owned.challenge.year, owned.challenge.month)) return notCurrentMonth()

  const { error } = await supabase
    .from('savings_challenges')
    .delete()
    .eq('challenge_id', challengeId)
    .eq('user_id', user.id)

  if (error) {
    const refusal = challengeRefusal(error)
    if (refusal) return refusal
    console.error('savings challenge delete failed', error.message)
    return NextResponse.json({ error: 'Failed to abandon the challenge' }, { status: 500 })
  }

  return new NextResponse(null, { status: 204 })
}
