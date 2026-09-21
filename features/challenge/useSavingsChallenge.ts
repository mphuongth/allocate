'use client'

// Loading and mutating one month's savings challenge.
//
// Two screens show the same month — the section on Planning and the small card
// on the dashboard — and they must not disagree about how much has been set
// aside. Everything they display is derived from `challengeMonthState`, so the
// disagreement has nowhere to come from: this hook holds only the raw month
// (the step + which days are ticked) and hands the derivation the same inputs.
//
// Ticking is optimistic. A checkbox that waits for a round trip before it fills
// in feels broken on a phone, and the cost of being wrong is small and visible:
// the day flips back and a toast says why.
//
// Both the optimistic write and its rollback touch only THEIR OWN day, through
// the updater form. Snapshotting the list and restoring it wholesale is the
// obvious way to write this and it is wrong: tapping two days in quick
// succession means the first request's rollback restores a list that predates
// the second tick, silently un-ticking a day the server accepted.

import { useCallback, useEffect, useRef, useState } from 'react'
import { challengeMonthState, type ChallengeMonthState } from '@/lib/savingsChallenge'

// Not exported: consumers read it through SavingsChallengeState['challenge'],
// and a second exported name for the same shape as the server's ChallengeRow
// (app/api/v1/savings-challenges/challengeAccess) is one the two could drift on.
type ChallengeRow = {
  challenge_id: string
  year: number
  month: number
  unit_vnd: number
}

export type SavingsChallengeState = {
  challenge: ChallengeRow | null
  days: number[]
  view: ChallengeMonthState
  loading: boolean
  /** The month could not be read at all — distinct from "no challenge yet". */
  error: boolean
  /** A write is in flight; the step controls disable rather than queue. */
  busy: boolean
  reload: () => void
  start: (unitVnd: number) => Promise<boolean>
  restep: (unitVnd: number) => Promise<boolean>
  abandon: () => Promise<boolean>
  toggleDay: (day: number) => Promise<boolean>
}

const BASE = '/api/v1/savings-challenges'

async function refusalMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json()
    return typeof body?.error === 'string' && body.error ? body.error : fallback
  } catch {
    return fallback
  }
}

export function useSavingsChallenge(
  year: number,
  month: number,
  onError?: (message: string) => void,
): SavingsChallengeState {
  const [challenge, setChallenge] = useState<ChallengeRow | null>(null)
  const [days, setDays] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  // Which month the in-flight fetch is for. A user stepping through months
  // faster than the network answers would otherwise see an older month's
  // response land on top of a newer one.
  const wantedRef = useRef('')
  const notify = useRef(onError)
  notify.current = onError

  useEffect(() => {
    const wanted = `${year}-${month}`
    wantedRef.current = wanted
    let cancelled = false
    setLoading(true)
    setError(false)

    fetch(`${BASE}?year=${year}&month=${month}`)
      .then(async res => {
        if (!res.ok) throw new Error(String(res.status))
        return res.json()
      })
      .then((body: { challenge: ChallengeRow | null; days: number[] }) => {
        if (cancelled || wantedRef.current !== wanted) return
        setChallenge(body.challenge ?? null)
        setDays(Array.isArray(body.days) ? body.days : [])
        setLoading(false)
      })
      .catch(() => {
        if (cancelled || wantedRef.current !== wanted) return
        // NOT "no challenge yet": that shape offers the step picker, and
        // offering it over a failed read invites the user to start a month they
        // may already have started.
        setChallenge(null)
        setDays([])
        setError(true)
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [year, month, reloadKey])

  const reload = useCallback(() => setReloadKey(k => k + 1), [])

  const fail = useCallback((message: string) => {
    notify.current?.(message)
    return false
  }, [])

  const start = useCallback(async (unitVnd: number) => {
    setBusy(true)
    try {
      const res = await fetch(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month, unit_vnd: unitVnd }),
      })
      if (!res.ok) return fail(await refusalMessage(res, 'Could not start the challenge.'))
      setChallenge(await res.json())
      setDays([])
      return true
    } catch {
      return fail('Could not start the challenge.')
    } finally {
      setBusy(false)
    }
  }, [year, month, fail])

  const restep = useCallback(async (unitVnd: number) => {
    if (!challenge) return false
    setBusy(true)
    try {
      const res = await fetch(`${BASE}/${challenge.challenge_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_vnd: unitVnd }),
      })
      if (!res.ok) return fail(await refusalMessage(res, 'Could not change the amount.'))
      setChallenge(await res.json())
      return true
    } catch {
      return fail('Could not change the amount.')
    } finally {
      setBusy(false)
    }
  }, [challenge, fail])

  const abandon = useCallback(async () => {
    if (!challenge) return false
    setBusy(true)
    try {
      const res = await fetch(`${BASE}/${challenge.challenge_id}`, { method: 'DELETE' })
      if (!res.ok) return fail(await refusalMessage(res, 'Could not cancel the challenge.'))
      setChallenge(null)
      setDays([])
      return true
    } catch {
      return fail('Could not cancel the challenge.')
    } finally {
      setBusy(false)
    }
  }, [challenge, fail])

  const toggleDay = useCallback(async (day: number) => {
    if (!challenge) return false
    const ticked = days.includes(day)
    const add = (list: number[]) => (list.includes(day) ? list : [...list, day])
    const drop = (list: number[]) => list.filter(d => d !== day)

    setDays(ticked ? drop : add)

    const undo = (message: string) => {
      setDays(ticked ? add : drop)
      return fail(message)
    }

    try {
      const res = ticked
        ? await fetch(`${BASE}/${challenge.challenge_id}/days/${day}`, { method: 'DELETE' })
        : await fetch(`${BASE}/${challenge.challenge_id}/days`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ day }),
          })
      if (!res.ok) return undo(await refusalMessage(res, 'Could not save that day.'))
      return true
    } catch {
      return undo('Could not save that day.')
    }
  }, [challenge, days, fail])

  return {
    challenge,
    days,
    view: challengeMonthState({ year, month, unitVnd: challenge?.unit_vnd ?? null, checkedDays: days }),
    loading,
    error,
    busy,
    reload,
    start,
    restep,
    abandon,
    toggleDay,
  }
}
