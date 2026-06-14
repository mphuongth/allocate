// Value a single non-fund holding (bank / stock / gold) the way the dashboard
// overview does, after applying any partial withdrawals parented to it. This is
// the money-critical core of the overview route's non-fund loop, lifted into a
// pure function so it can be unit-tested in CI — the full route flow is only
// covered by the local-only E2E suite.
//
// Renewal note: a renewed deposit's closed-cycle withdrawals are re-parented
// onto the (excluded) history snapshot, so `parentWdMap` ends up keyed by the
// snapshot's id, not the active row's. The active row therefore finds no
// withdrawal here and keeps its full rolled-forward principal — the withdrawn
// amount is NOT subtracted a second time (see lib/__tests__/depositValuation
// and e2e/goal-detail-desktop.spec.ts).

import { calcProjectedInterest } from './finance'
import type { ParentWdMap } from './withdrawalProgress'

export interface NonFundHoldingRow {
  transaction_id: string
  asset_type: string | null
  amount_vnd: number
  units: number | null
  interest_rate: number | null
  investment_date: string
  expiry_date: string | null
}

export interface NonFundValuation {
  effectiveAmount: number
  currentValue: number
  effectiveUnits: number | null
}

// Returns the holding's effective (post-withdrawal) principal, current value and
// remaining units, or `null` when it is fully withdrawn/sold and the caller
// should skip it. `asOf` defaults to now; pass it for deterministic tests.
export function valueNonFundHolding(
  tx: NonFundHoldingRow,
  parentWdMap: ParentWdMap,
  goldPricePerChi: number | null,
  asOf: number = Date.now(),
): NonFundValuation | null {
  const wd = parentWdMap.get(tx.transaction_id)
  const withdrawnPrincipal = wd?.principal ?? 0
  const withdrawnUnits = wd?.units ?? 0

  let effectiveUnits: number | null = tx.units ?? null

  if (tx.asset_type === 'gold' && goldPricePerChi && tx.units) {
    effectiveUnits = tx.units - withdrawnUnits
    if (effectiveUnits <= 0) return null // fully sold
    return {
      effectiveAmount: tx.amount_vnd - withdrawnPrincipal,
      currentValue: effectiveUnits * goldPricePerChi,
      effectiveUnits,
    }
  }

  const effectiveAmount = tx.amount_vnd - withdrawnPrincipal
  if (effectiveAmount <= 0) return null // fully withdrawn
  const interest = calcProjectedInterest(effectiveAmount, tx.interest_rate, tx.investment_date, tx.expiry_date, asOf)
  return { effectiveAmount, currentValue: effectiveAmount + interest, effectiveUnits }
}
