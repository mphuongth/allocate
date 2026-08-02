'use client'

import { useCallback, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useTranslations } from 'next-intl'
import type { Fund } from './useFundsData'

// The persistence half of the Fund Library's DCA and delete actions, shared by
// DesktopFundLibraryView and MobileFundLibraryView. Both used to carry their own
// copy — request, optimistic update, rollback, reload and busy-id bookkeeping —
// and the copies had already drifted in how they closed the editor and called
// their toast (#573).
//
// What stays in each view is what genuinely differs: the inline editor state
// (which fund is being edited, its draft value, whether this is a brand-new
// enable) and the layout. Turning DCA *on* is a view concern too — it opens the
// editor and persists nothing until an amount is entered.

/** Outcome of a delete, so a view can dismiss its own confirmation dialog. */
export type DeleteOutcome = 'deleted' | 'in-use' | 'failed'

export interface FundMutations {
  /** Funds with a request in flight — views disable their controls on these. */
  togglingIds: Set<string>
  /** Turn DCA off and persist it. */
  disableDca: (fund: Fund) => Promise<void>
  /**
   * Persist a validated monthly amount, keeping the fund's existing goal.
   *
   * @param isNewEnable this is the first save of a DCA the view just toggled
   *   on, so nothing is persisted behind it — a failure goes back to DCA off
   *   rather than to the fund's (locally already-enabled) state.
   */
  saveDcaAmount: (fund: Fund, amount: number, isNewEnable?: boolean) => Promise<void>
  setDcaGoal: (fund: Fund, goalId: string | null) => Promise<void>
  deleteFund: (fund: Fund) => Promise<DeleteOutcome>
}

/**
 * @param notify presentation is the one thing left to the view — the desktop
 *   toast takes a boolean, the mobile one a string. Both get the same message
 *   and the same success flag.
 */
export function useFundMutations({
  setFunds,
  reload,
  notify,
}: {
  setFunds: Dispatch<SetStateAction<Fund[]>>
  reload: () => Promise<void>
  notify: (message: string, ok: boolean) => void
}): FundMutations {
  const t = useTranslations('funds')
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())

  const patchFund = useCallback((id: string, changes: Partial<Fund>) => {
    setFunds((prev) => prev.map((f) => (f.id === id ? { ...f, ...changes } : f)))
  }, [setFunds])

  /**
   * Undo an optimistic write, but only while the row still holds it. Both
   * viewports stay mounted on the same funds state, so a second mutation (or
   * its reload) can land while the first request is still out — and then the
   * loser's rollback would overwrite a result the server actually confirmed.
   * If our own optimistic values are gone, someone else owns those fields now.
   */
  const rollbackFund = useCallback((id: string, optimistic: Partial<Fund>, rollback: Partial<Fund>) => {
    setFunds((prev) => prev.map((f) => {
      if (f.id !== id) return f
      const stillOurs = Object.entries(optimistic).every(([key, value]) => f[key as keyof Fund] === value)
      return stillOurs ? { ...f, ...rollback } : f
    }))
  }, [setFunds])

  /**
   * Every DCA write is a full PUT: the route's partial-update semantics key off
   * whether `is_dca` is present, and the unchanged columns have to come along or
   * they'd be overwritten with undefined.
   */
  const putFund = useCallback((fund: Fund, dca: Partial<Fund>) =>
    fetch(`/api/funds/${fund.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: fund.name,
        code: fund.code,
        fund_type: fund.fund_type,
        nav: fund.nav,
        nav_source_url: fund.nav_source_url,
        ...dca,
      }),
    }), [])

  /**
   * Apply an optimistic change, persist it, and undo it if the request fails.
   * One place, so the two viewports can't drift on when a rollback happens.
   *
   * The undo is the fund's own values for exactly the fields the optimistic
   * update touched, captured before the write. Spelling the rollback out per
   * call site is what produced #590: the amount save rolled back to a blanket
   * "DCA off", so a transient error told the user their configuration was gone
   * while the server still had it. `rollbackOverride` exists for the one case
   * the fund object can't describe — see `saveDcaAmount`. The undo itself is
   * conditional: see `rollbackFund`.
   */
  const persist = useCallback(async (
    fund: Fund,
    optimistic: Partial<Fund>,
    body: Partial<Fund>,
    failureMessage: string,
    rollbackOverride?: Partial<Fund>,
  ) => {
    const rollback: Partial<Fund> = rollbackOverride ?? Object.fromEntries(
      Object.keys(optimistic).map((key) => [key, fund[key as keyof Fund]]),
    )
    patchFund(fund.id, optimistic)
    setTogglingIds((prev) => new Set(prev).add(fund.id))
    try {
      const res = await putFund(fund, body)
      if (!res.ok) throw new Error()
      await reload()
    } catch {
      rollbackFund(fund.id, optimistic, rollback)
      notify(failureMessage, false)
    } finally {
      setTogglingIds((prev) => { const next = new Set(prev); next.delete(fund.id); return next })
    }
  }, [patchFund, rollbackFund, putFund, reload, notify])

  const disableDca = useCallback((fund: Fund) => persist(
    fund,
    { is_dca: false, dca_monthly_amount_vnd: null },
    { is_dca: false, dca_monthly_amount_vnd: null },
    t('toastDcaFailed'),
  ), [persist, t])

  const saveDcaAmount = useCallback((fund: Fund, amount: number, isNewEnable = false) => persist(
    fund,
    // Amount fields only, so the derived rollback stays out of the goal: the
    // goal selector is live while this is in flight, and a goal change that
    // lands first is the server's truth — restoring the goal captured here
    // would undo it.
    { is_dca: true, dca_monthly_amount_vnd: amount },
    { is_dca: true, dca_monthly_amount_vnd: amount, dca_goal_id: fund.dca_goal_id },
    t('toastDcaFailed'),
    // Turning DCA on flips `is_dca` locally before anything is persisted, so on
    // a first save the fund's own state isn't what to restore — off is (#2).
    isNewEnable ? { is_dca: false, dca_monthly_amount_vnd: null } : undefined,
  ), [persist, t])

  const setDcaGoal = useCallback((fund: Fund, goalId: string | null) => persist(
    fund,
    { dca_goal_id: goalId },
    { is_dca: true, dca_monthly_amount_vnd: fund.dca_monthly_amount_vnd, dca_goal_id: goalId },
    t('toastGoalFailed'),
  ), [persist, t])

  const deleteFund = useCallback(async (fund: Fund): Promise<DeleteOutcome> => {
    try {
      const res = await fetch(`/api/funds/${fund.id}`, { method: 'DELETE' })
      // Hard block: a fund used in a monthly plan can't be deleted (#1). Say so
      // specifically — a generic failure toast leaves the user retrying
      // something that can never succeed.
      if (res.status === 409) {
        notify(t('toastDeleteInUse'), false)
        return 'in-use'
      }
      if (!res.ok && res.status !== 204) throw new Error()
      await reload()
      notify(t('toastDeleted'), true)
      return 'deleted'
    } catch {
      notify(t('toastDeleteFailed'), false)
      return 'failed'
    }
  }, [reload, notify, t])

  return { togglingIds, disableDca, saveDcaAmount, setDcaGoal, deleteFund }
}
