'use client'

// Loading and mutating one month's savings challenge.
//
// Two screens show the same month — the section on Planning and the small card
// on the dashboard — and they must not disagree about how much has been set
// aside. Everything they display is derived from `challengeMonthState`, so the
// disagreement has nowhere to come from: this hook holds only the raw month
// (the step + which days are ticked) and hands the derivation the same inputs.
//
// Ticking is optimistic, and so is picking the month's step. A control that
// waits for a round trip before it changes feels broken on a phone, and the cost
// of being wrong is small and visible: the thing flips back and a toast says
// why. Picking a step is the one that used to get this wrong — the whole card
// sat on the old shape until the POST answered, which on a slow connection reads
// as a dead button rather than as a wait.
//
// Both the optimistic write and its rollback touch only THEIR OWN day, through
// the updater form. Snapshotting the list and restoring it wholesale is the
// obvious way to write this and it is wrong: tapping two days in quick
// succession means the first request's rollback restores a list that predates
// the second tick, silently un-ticking a day the server accepted.
//
// Re-pricing has the same trap in a different shape. Two presses in quick
// succession, the first refused after the second lands, would roll back to a
// step the user has already moved on from — so a rollback only happens while its
// own request is still the newest one (`stepSeq`).

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
  /** The server's row. null until a start is confirmed — no id, nothing tickable. */
  challenge: ChallengeRow | null
  /**
   * The step the month is running at AS SHOWN, which is the chosen one from the
   * moment it is pressed. Ahead of `challenge` while a start or a re-price is in
   * flight; that gap is the optimism, and it is what the card renders from.
   */
  unitVnd: number | null
  days: number[]
  view: ChallengeMonthState
  loading: boolean
  /** The month could not be read at all — distinct from "no challenge yet". */
  error: boolean
  /**
   * A write that cannot be shown optimistically is in flight — which is only
   * abandoning the month. Starting and re-pricing no longer raise it: disabling
   * the picker for the length of a round trip is the stall this was.
   */
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
  // The step of a start that has not been confirmed yet. Only ever set while
  // `challenge` is null — once the row exists, the optimistic value lives on the
  // row itself, so there is one place to read the current step from.
  const [pendingUnitVnd, setPendingUnitVnd] = useState<number | null>(null)
  const [days, setDays] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  // Which month the in-flight fetch is for. A user stepping through months
  // faster than the network answers would otherwise see an older month's
  // response land on top of a newer one.
  const wantedRef = useRef('')
  // Which re-price is the newest. A refusal only rolls back while it is still
  // the one the user is waiting on.
  const stepSeq = useRef(0)
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
        setPendingUnitVnd(null)
        setDays(Array.isArray(body.days) ? body.days : [])
        setLoading(false)
      })
      .catch(() => {
        if (cancelled || wantedRef.current !== wanted) return
        // NOT "no challenge yet": that shape offers the step picker, and
        // offering it over a failed read invites the user to start a month they
        // may already have started.
        setChallenge(null)
        setPendingUnitVnd(null)
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
    // On screen immediately: the month's schedule is a pure function of the step
    // and the calendar, so it can be drawn before anything is written. Only the
    // id has to come from the server, and nothing is tickable without one.
    setPendingUnitVnd(unitVnd)
    setDays([])
    try {
      const res = await fetch(BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month, unit_vnd: unitVnd }),
      })
      if (!res.ok) {
        setPendingUnitVnd(null)
        return fail(await refusalMessage(res, 'Could not start the challenge.'))
      }
      setChallenge(await res.json())
      setPendingUnitVnd(null)
      return true
    } catch {
      setPendingUnitVnd(null)
      return fail('Could not start the challenge.')
    }
  }, [year, month, fail])

  const restep = useCallback(async (unitVnd: number) => {
    if (!challenge) return false
    const seq = ++stepSeq.current
    const previous = challenge.unit_vnd
    // Only this field, through the updater form — the same discipline the day
    // list keeps, so a stale answer cannot restore a whole stale row.
    const undo = () => {
      if (stepSeq.current !== seq) return
      setChallenge(c => (c ? { ...c, unit_vnd: previous } : c))
    }
    setChallenge(c => (c ? { ...c, unit_vnd: unitVnd } : c))

    try {
      const res = await fetch(`${BASE}/${challenge.challenge_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_vnd: unitVnd }),
      })
      if (!res.ok) {
        undo()
        return fail(await refusalMessage(res, 'Could not change the amount.'))
      }
      const row = await res.json()
      // A confirmation that has been overtaken is not news: the newer press owns
      // the row now, and writing this one back would move the step under the
      // user's hand.
      if (stepSeq.current === seq) setChallenge(row)
      return true
    } catch {
      undo()
      return fail('Could not change the amount.')
    }
  }, [challenge, fail])

  const abandon = useCallback(async () => {
    if (!challenge) return false
    setBusy(true)
    try {
      const res = await fetch(`${BASE}/${challenge.challenge_id}`, { method: 'DELETE' })
      if (!res.ok) return fail(await refusalMessage(res, 'Could not cancel the challenge.'))
      setChallenge(null)
      setPendingUnitVnd(null)
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

  const unitVnd = challenge?.unit_vnd ?? pendingUnitVnd

  return {
    challenge,
    unitVnd,
    days,
    view: challengeMonthState({ year, month, unitVnd, checkedDays: days }),
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
