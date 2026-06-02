// Shared types + pure helpers for the dashboard Recent activity card and the
// "View all" transaction ledger. Both render rows from the same
// /api/v1/investment-transactions shape, so the display logic lives here.

export interface LedgerTransaction {
  transaction_id: string
  goal_id: string | null
  asset_type: string | null
  transaction_type?: string
  investment_date: string
  amount_vnd: number
  unit_price: number | null
  units: number | null
  interest_rate: number | null
  expiry_date: string | null
  fund_id: string | null
  notes: string | null
  principal_withdrawn?: number | null
  units_withdrawn?: number | null
  savings_goals?: { goal_name: string } | null
  funds?: { id: string; name: string; nav: number } | { id: string; name: string; nav: number }[] | null
}

export const ASSET_TYPES = ['fund', 'bank', 'stock', 'gold'] as const
export type AssetType = (typeof ASSET_TYPES)[number]

// The funds relation can come back as an object or a single-element array
// depending on the Supabase join shape — normalize to the fund name.
export function fundNameOf(tx: LedgerTransaction): string | null {
  const f = tx.funds
  if (!f) return null
  const fund = Array.isArray(f) ? f[0] : f
  return fund?.name ?? null
}

export function isWithdrawal(tx: LedgerTransaction): boolean {
  return tx.transaction_type === 'withdrawal'
}

// Per the data model (decision: match real schema), every row is either an
// investment (positive, +) or a withdrawal (negative, −). Returns the sign and
// the semantic color so the card and ledger render identically.
export function txSign(tx: LedgerTransaction): { sign: '+' | '−'; positive: boolean } {
  const positive = !isWithdrawal(tx)
  return { sign: positive ? '+' : '−', positive }
}

// Primary label shown in a row: the fund name for funds, otherwise the notes,
// falling back to the asset-type label provided by the caller (i18n lives in
// the component).
export function txPrimaryName(tx: LedgerTransaction, assetLabel: string): string {
  return fundNameOf(tx) || (tx.notes?.trim() || '') || assetLabel
}

export function fmtTxDate(d: string, locale: string): string {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}
