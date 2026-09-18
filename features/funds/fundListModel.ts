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
  // Left as "ETF" in both languages on purpose: it is the name printed on the
  // listing, the one brokers use, and the one a user searches for.
  etf:      { label: 'ETF',      labelVi: 'ETF',        color: 'var(--c-fund-etf)',      bg: 'var(--c-fund-etf-bg)' },
}

export const TYPE_FILTERS: { v: TypeFilter; label: string; labelVi: string }[] = [
  { v: 'all',      label: 'All',      labelVi: 'Tất cả' },
  { v: 'equity',   label: 'Stock',    labelVi: 'Cổ phiếu' },
  { v: 'debt',     label: 'Bond',     labelVi: 'Trái phiếu' },
  { v: 'balanced', label: 'Balanced', labelVi: 'Cân bằng' },
  { v: 'etf',      label: 'ETF',      labelVi: 'ETF' },
]

/**
 * Selectable fund types in the create/edit form. Gold is excluded — it is
 * tracked via byType, not created as a user fund.
 */
export const FORM_TYPES = (Object.keys(TYPE_META) as FundType[]).filter((ft) => ft !== 'gold')

/**
 * What a fund's price is called on screen.
 *
 * An ETF has two prices at once: the NAV per certificate its manager publishes,
 * and the market price the exchange sets — different numbers on the same day,
 * because an ETF trades at a premium or a discount to its own NAV. `funds.nav`
 * holds whichever one prices the holding, so for an ETF that column is the
 * MARKET price and labelling it "NAV" puts one number's name over another's
 * value.
 *
 * Anything that is not an ETF is a NAV, including a type this build has not
 * heard of: every fund that existed before ETFs is priced that way, and an
 * unrecognised type is likelier to be another open-ended fund than a listing.
 */
export function priceTerm(fundType: string | null | undefined): 'marketPrice' | 'nav' {
  return fundType === 'etf' ? 'marketPrice' : 'nav'
}

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
