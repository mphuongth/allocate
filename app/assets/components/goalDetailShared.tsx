// Shared helpers for the goal-detail views (GoalDetailSheet on mobile,
// DesktopGoalDetail on desktop). Both render the same data with different
// chrome, so the icons, colours, deadline math and — most importantly — the
// investment-row valuation live here to stay in sync.

import { TrendingUp, Building, CircleDollarSign, BarChart2 } from 'lucide-react'
import type { FundBreakdownItem } from '../DashboardClient'

export const GD_COLORS: Record<string, string> = {
  fund: '#2563eb',
  bank: '#047857',
  gold: '#d97706',
  stock: '#7c3aed',
}

export function calcDeadlineMonths(targetDate: string | null): number {
  if (!targetDate) return 12
  const [ty, tm] = targetDate.split('-').map(Number)
  const now = new Date()
  return Math.max(1, (ty - now.getFullYear()) * 12 + (tm - 1 - now.getMonth()))
}

export function TypeIcon({ type, size = 16 }: { type: string; size?: number }) {
  if (type === 'fund') return <TrendingUp size={size} />
  if (type === 'bank') return <Building size={size} />
  if (type === 'gold') return <CircleDollarSign size={size} />
  return <BarChart2 size={size} />
}

// The design's "unlink" glyph, used by the unassign-from-goal affordance.
export function UnlinkSvg({ size = 18, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      <path d="M2 2l20 20" />
    </svg>
  )
}

export interface InvRow {
  id: string
  name: string
  type: string
  value: number
  gainPct: number | null
  units: number | null
  principal: number | null
  interestRate: number | null
  fund: FundBreakdownItem | null
}

// Minimal shape buildInvRows needs — both views' richer InvestmentTx types
// are structurally assignable to this.
export interface GoalDetailTx {
  transaction_id: string
  transaction_type: string
  asset_type: string
  fund_id: string | null
  parent_transaction_id: string | null
  investment_date: string
  amount_vnd: number
  units: number | null
  interest_rate: number | null
  notes: string | null
  principal_withdrawn: number | null
  units_withdrawn: number | null
}

// Dedup to one row per fund / per non-fund tx, then value each holding:
// funds at their current value, bank deposits at compounded interest, gold at
// the live price per chỉ, and everything else at cost — each net of any
// partial withdrawals (issues #251, #261). Holdings that have been fully
// withdrawn / sold are dropped so they no longer appear on the investment tab.
// Returns rows otherwise unfiltered — callers apply their own optimistic
// unassign filter.
export function buildInvRows(
  transactions: GoalDetailTx[],
  funds: FundBreakdownItem[],
  goldPricePerChi: number | null,
  isVi: boolean,
): InvRow[] {
  // Aggregate withdrawals onto their parent holding. Bank/gold withdrawals are
  // stored as separate `withdrawal` rows linked via parent_transaction_id, so
  // the parent investment row itself carries no withdrawn amounts — without
  // this a withdrawn deposit would still show at full value (issue #261). All
  // withdrawals count here (regardless of affects_progress): the tab shows what
  // is actually still held.
  const wdByParent = new Map<string, { principal: number; units: number }>()
  for (const tx of transactions) {
    if (tx.transaction_type === 'withdrawal' && tx.parent_transaction_id) {
      const e = wdByParent.get(tx.parent_transaction_id) ?? { principal: 0, units: 0 }
      e.principal += tx.principal_withdrawn ?? 0
      e.units += tx.units_withdrawn ?? 0
      wdByParent.set(tx.parent_transaction_id, e)
    }
  }

  const investmentRows = transactions.filter((tx) => tx.transaction_type !== 'withdrawal')
  const deduped = new Map<string, GoalDetailTx>()
  investmentRows.forEach((tx) => {
    if (tx.fund_id) {
      if (!deduped.has(tx.fund_id)) deduped.set(tx.fund_id, tx)
    } else {
      deduped.set(tx.transaction_id, tx)
    }
  })
  const fundMap = new Map(funds.map((f) => [f.fundId, f]))

  return Array.from(deduped.values()).map((tx): InvRow | null => {
    const fund = tx.fund_id ? fundMap.get(tx.fund_id) ?? null : null
    const name = fund?.fundName ?? tx.notes ?? (
      tx.asset_type === 'bank' ? (isVi ? 'Tiền gửi' : 'Bank deposit') :
      tx.asset_type === 'gold' ? (isVi ? 'Vàng' : 'Gold') : tx.asset_type
    )

    let value: number, gainPct: number | null, units: number | null, principal: number | null
    if (fund) {
      value = fund.currentValue
      gainPct = fund.profitLossPercentage
      units = fund.quantity
      principal = null
    } else {
      const wd = wdByParent.get(tx.transaction_id)
      const effectivePrincipal = tx.amount_vnd - (wd?.principal ?? 0)

      if (tx.asset_type === 'gold' && goldPricePerChi && tx.units) {
        const effectiveUnits = tx.units - (wd?.units ?? 0)
        if (effectiveUnits <= 0) return null // fully sold
        value = effectiveUnits * goldPricePerChi
        gainPct = effectivePrincipal > 0 ? ((value - effectivePrincipal) / effectivePrincipal) * 100 : null
        units = effectiveUnits
        principal = effectivePrincipal
      } else {
        if (effectivePrincipal <= 0) return null // fully withdrawn
        if (tx.asset_type === 'bank' && tx.interest_rate) {
          const months = Math.max(0, Math.floor(
            (Date.now() - new Date(tx.investment_date).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
          ))
          value = Math.round(effectivePrincipal * Math.pow(1 + tx.interest_rate / 100 / 12, months))
          gainPct = ((value - effectivePrincipal) / effectivePrincipal) * 100
          units = null
          principal = effectivePrincipal
        } else {
          value = effectivePrincipal
          gainPct = null
          units = tx.units
          principal = effectivePrincipal
        }
      }
    }

    return { id: tx.transaction_id, name, type: tx.asset_type, value, gainPct, units, principal, interestRate: tx.interest_rate ?? null, fund: fund ?? null }
  }).filter((row): row is InvRow => row !== null)
}
