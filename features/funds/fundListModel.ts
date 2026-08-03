// The fund library's list derivation and type metadata (#603).
//
// Desktop and mobile each carried their own copy of the filter+sort and a
// byte-identical TYPE_META / TYPE_FILTERS / FORM_TYPES. Same behavior, written
// twice, free to drift — and neither copy was reachable by a test without
// rendering a whole 830-line view.
//
// Deliberately NOT shared: the table and the card list. Those genuinely differ,
// and merging them would trade real duplication for a component full of
// breakpoint conditionals.

import type { Fund, FundType, SortKey, TypeFilter } from './contracts'

export const TYPE_META: Record<FundType, { label: string; labelVi: string; color: string; bg: string }> = {
  equity:   { label: 'Stock',    labelVi: 'Cổ phiếu',   color: 'var(--c-fund-equity)',   bg: 'var(--c-fund-equity-bg)' },
  debt:     { label: 'Bond',     labelVi: 'Trái phiếu', color: 'var(--c-fund-debt)',     bg: 'var(--c-fund-debt-bg)' },
  balanced: { label: 'Balanced', labelVi: 'Cân bằng',   color: 'var(--c-fund-balanced)', bg: 'var(--c-fund-balanced-bg)' },
  gold:     { label: 'Gold',     labelVi: 'Vàng',       color: 'var(--c-fund-gold)',     bg: 'var(--c-fund-gold-bg)' },
}

export const TYPE_FILTERS: { v: TypeFilter; label: string; labelVi: string }[] = [
  { v: 'all',      label: 'All',      labelVi: 'Tất cả' },
  { v: 'equity',   label: 'Stock',    labelVi: 'Cổ phiếu' },
  { v: 'debt',     label: 'Bond',     labelVi: 'Trái phiếu' },
  { v: 'balanced', label: 'Balanced', labelVi: 'Cân bằng' },
]

/**
 * Selectable fund types in the create/edit form. Gold is excluded — it is
 * tracked via byType, not created as a user fund.
 */
export const FORM_TYPES = (Object.keys(TYPE_META) as FundType[]).filter((ft) => ft !== 'gold')

export interface FundListControls {
  query: string
  typeFilter: TypeFilter
  sortKey: SortKey
  sortAsc: boolean
}

/**
 * The funds a view should render, in order. Filter by type, then by the search
 * over code and name, then sort. NAV sorts numerically; the rest compare as
 * text. Never mutates the input.
 */
export function filterAndSortFunds(funds: Fund[], controls: FundListControls): Fund[] {
  const { query, typeFilter, sortKey, sortAsc } = controls
  let list = funds
  if (typeFilter !== 'all') list = list.filter((f) => f.fund_type === typeFilter)
  if (query) {
    const q = query.toLowerCase()
    list = list.filter((f) => f.code.toLowerCase().includes(q) || f.name.toLowerCase().includes(q))
  }
  return [...list].sort((a, b) => {
    const cmp = sortKey === 'nav' ? a.nav - b.nav : a[sortKey].localeCompare(b[sortKey])
    return sortAsc ? cmp : -cmp
  })
}

/**
 * Clicking a column header: the same column flips direction, a new one starts
 * ascending (a fresh column should always read top-down, not inherit the
 * previous column's direction).
 */
export function nextSort(
  current: { sortKey: SortKey; sortAsc: boolean },
  key: SortKey,
): { sortKey: SortKey; sortAsc: boolean } {
  return current.sortKey === key
    ? { sortKey: key, sortAsc: !current.sortAsc }
    : { sortKey: key, sortAsc: true }
}
