// Accumulating ("Loại 2") bank deposits: one logical book topped up over time,
// each top-up a tranche with its own locked-in rate, all sharing the book's
// maturity. A tranche is an investment_transactions row; the book is the set of
// rows sharing a deposit_group_id (the anchor row self-groups). The grouping and
// per-row valuation helpers here are pure (no DB) — `buildCollapsePlan` is the
// one piece that touches the interest formula, reusing lib/finance's single
// source of truth so a book collapse never re-derives interest in SQL.

import { calcProjectedInterest } from './finance'

export function isAccumulating(row: { depositGroupId?: string | null }): boolean {
  return row.depositGroupId != null
}

// The book id a row belongs to: its group when grouped, else itself (a term /
// one-off holding is its own "book of one"). Lets callers group-by uniformly.
export function anchorId(row: { transactionId: string; depositGroupId?: string | null }): string {
  return row.depositGroupId ?? row.transactionId
}

// Amount-weighted average rate across a book's tranches — what the detail view
// shows as "Avg rate / Lãi suất TB". A null tranche rate counts as 0. Returns 0
// when the book holds no principal.
export function blendedRate(tranches: { amount: number; rate: number | null }[]): number {
  const total = tranches.reduce((s, t) => s + t.amount, 0)
  if (total <= 0) return 0
  return tranches.reduce((s, t) => s + t.amount * (t.rate ?? 0), 0) / total
}

// One live tranche of a book about to be collapsed at maturity: its effective
// (post-withdrawal) principal plus the inputs needed to value its accrued
// interest on its own locked rate.
export interface CollapseTrancheInput {
  id: string
  principal: number
  rate: number | null
  investmentDate: string
  expiryDate: string | null
}

export interface CollapsePlan {
  // Per-tranche principal + accrued interest, one entry per input. The collapse
  // route writes each `interest` onto that tranche's history snapshot, so the
  // book's history records the real interest of every top-up cycle.
  tranches: { id: string; principal: number; interest: number }[]
  totalPrincipal: number
  totalInterest: number
}

// Value a book at collapse time: each tranche earns interest on its own rate,
// capped at the shared maturity (calcProjectedInterest is the single formula —
// see lib/finance), rounded per tranche so the book total equals the sum of the
// per-tranche figures the snapshots store (no rolled-lump vs history drift). The
// caller passes effective (post-withdrawal) principals, so a withdrawal that
// spanned a tranche is already netted out before it reaches here.
export function buildCollapsePlan(tranches: CollapseTrancheInput[], asOf?: number): CollapsePlan {
  const out = tranches.map((t) => ({
    id: t.id,
    principal: t.principal,
    interest: Math.round(calcProjectedInterest(t.principal, t.rate, t.investmentDate, t.expiryDate, asOf)),
  }))
  return {
    tranches: out,
    totalPrincipal: out.reduce((s, t) => s + t.principal, 0),
    totalInterest: out.reduce((s, t) => s + t.interest, 0),
  }
}
