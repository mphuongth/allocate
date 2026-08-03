'use client'

import { useCallback, useEffect, useState } from 'react'
import { allocateCumulative } from '@/lib/maturity'
import { defaultReceivedFor } from './mergeSelection'
import type { InvRow } from '../contracts'

export interface MergeSelection {
  /** Sources currently folded into the re-deposit, in the caller's order. */
  selectedSources: InvRow[]
  /** Σ of the received amounts — what the merge contributes to the new principal. */
  mergeReceivedTotal: number
  /**
   * Set one source's received cash. Also clears the TOTAL field: once the user
   * edits a part by hand, the total they typed no longer describes the split.
   */
  setReceived: (id: string, value: string) => void
  /** Per-source received cash, as raw field strings. */
  mergeRecv: Record<string, string>
  /** The single TOTAL field, when the user drives the split from one number. */
  mergeTotal: string
  isSelected: (id: string) => boolean
  /** Folded in early despite being out of window ("Gộp sớm?"). */
  isOverridden: (id: string) => boolean
  toggleSource: (s: InvRow) => void
  overrideSource: (s: InvRow) => void
  onMergeTotalChange: (value: string) => void
}

/**
 * The merge picker's selection state (#602) — four state maps and the five
 * closures over them that used to live inside MaturityResolveBody.
 *
 * Selection is layered: an explicit toggle wins, then an early-fold override,
 * then the eligibility default. That is what lets a preselected sibling be
 * turned off, and an out-of-window one be pulled in, without either decision
 * being clobbered when the window changes.
 *
 * @param sources    Mergeable siblings, in display order.
 * @param isEligible Eligibility default for a source id, as the sheet computed it.
 * @param windowDays The merge window; widening it re-runs the prefill.
 */
export function useMergeSelection(
  sources: InvRow[],
  isEligible: (id: string) => boolean,
  windowDays: number,
): MergeSelection {
  const [mergeSel, setMergeSel] = useState<Record<string, boolean>>({})
  const [overridden, setOverridden] = useState<Record<string, boolean>>({})
  const [mergeRecv, setMergeRecv] = useState<Record<string, string>>({})
  const [mergeTotal, setMergeTotal] = useState('')

  const isSelected = useCallback((id: string): boolean => {
    if (id in mergeSel) return mergeSel[id]
    if (overridden[id]) return true
    return isEligible(id)
  }, [mergeSel, overridden, isEligible])

  const isOverridden = useCallback((id: string) => !!overridden[id], [overridden])

  // Prefill a source's received with its current value. No-op once it has one,
  // so a figure the user typed is never overwritten.
  const prefillReceived = useCallback((s: InvRow) => {
    setMergeRecv((prev) =>
      prev[s.id] === undefined || prev[s.id] === ''
        ? { ...prev, [s.id]: String(defaultReceivedFor(s)) }
        : prev,
    )
  }, [])

  // Turning an overridden source off also drops the override, so it returns to
  // the dimmed "Gộp sớm?" row rather than sitting deselected-but-overridden.
  const toggleSource = useCallback((s: InvRow) => {
    const on = !isSelected(s.id)
    setMergeSel((prev) => ({ ...prev, [s.id]: on }))
    if (on) prefillReceived(s)
    else if (overridden[s.id]) setOverridden((prev) => { const n = { ...prev }; delete n[s.id]; return n })
  }, [isSelected, overridden, prefillReceived])

  const overrideSource = useCallback((s: InvRow) => {
    setOverridden((prev) => ({ ...prev, [s.id]: true }))
    setMergeSel((prev) => ({ ...prev, [s.id]: true }))
    prefillReceived(s)
  }, [prefillReceived])

  const setReceived = useCallback((id: string, value: string) => {
    setMergeRecv((prev) => ({ ...prev, [id]: value }))
    setMergeTotal('')
  }, [])

  // Keep the received map in step with the eligibility default: on mount, and
  // whenever the window widens, prefill any now-selected source that has no
  // received value — otherwise a preselected sibling submits 0₫.
  useEffect(() => {
    setMergeRecv((prev) => {
      let changed = false
      const next = { ...prev }
      sources.forEach((s) => {
        if (isSelected(s.id) && (next[s.id] === undefined || next[s.id] === '')) {
          next[s.id] = String(defaultReceivedFor(s))
          changed = true
        }
      })
      return changed ? next : prev
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowDays])

  /**
   * Editing the single TOTAL splits it across the selected sources with the
   * same cumulative-window allocation the SQL uses — so Σ(received) equals the
   * typed total exactly, with no rounding drift between preview and server.
   */
  const onMergeTotalChange = useCallback((v: string) => {
    setMergeTotal(v)
    const total = Math.round(Number(v) || 0)
    const sel = sources.filter((s) => isSelected(s.id))
    const alloc = allocateCumulative(total, sel.map((s) => Math.round(s.principal ?? s.value ?? 0)))
    setMergeRecv((prev) => {
      const next = { ...prev }
      sel.forEach((s, i) => { next[s.id] = String(alloc[i]) })
      return next
    })
  }, [sources, isSelected])

  const selectedSources = sources.filter((s) => isSelected(s.id))
  const mergeReceivedTotal = selectedSources.reduce((sum, s) => sum + (Number(mergeRecv[s.id]) || 0), 0)

  return {
    selectedSources, mergeReceivedTotal, mergeRecv, mergeTotal,
    isSelected, isOverridden, toggleSource, overrideSource, setReceived, onMergeTotalChange,
  }
}
