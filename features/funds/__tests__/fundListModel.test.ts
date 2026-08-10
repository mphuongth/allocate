import { describe, it, expect } from 'vitest'
import type { Fund } from '../contracts'
import { filterAndSortFunds, nextSort, TYPE_META, TYPE_FILTERS, FORM_TYPES } from '../fundListModel'

// The fund library's list derivation (#603). Desktop and mobile each had their
// own copy of the filter+sort — same behavior, written twice, free to drift.
// Extracted so the rule is stated once and tested once, while the two views
// keep their own (genuinely different) table and card layouts.

const fund = (over: Partial<Fund> = {}): Fund => ({
  id: 'f1', name: 'VESAF', code: 'VESAF', fund_type: 'equity', nav: 20_000,
  nav_auto_sync: false, is_dca: false, dca_monthly_amount_vnd: null, dca_goal_id: null,
  created_at: '2026-01-01', updated_at: '2026-01-01', ...over,
})

const funds = [
  fund({ id: '1', code: 'VESAF', name: 'VinaCapital Equity', fund_type: 'equity', nav: 30_000 }),
  fund({ id: '2', code: 'TCBF', name: 'Techcom Bond', fund_type: 'debt', nav: 10_000 }),
  fund({ id: '3', code: 'BALAN', name: 'Alpha Balanced', fund_type: 'balanced', nav: 20_000 }),
]

const codes = (list: Fund[]) => list.map((f) => f.code)
const all = { query: '', typeFilter: 'all' as const, sortKey: 'code' as const, sortAsc: true }

describe('filterAndSortFunds', () => {
  it('sorts by code ascending by default', () => {
    expect(codes(filterAndSortFunds(funds, all))).toEqual(['BALAN', 'TCBF', 'VESAF'])
  })

  it('reverses on descending', () => {
    expect(codes(filterAndSortFunds(funds, { ...all, sortAsc: false }))).toEqual(['VESAF', 'TCBF', 'BALAN'])
  })

  it('sorts NAV numerically, not as text', () => {
    // '10000' < '20000' < '30000' happens to agree as strings; 9,000 would not.
    const withSmall = [...funds, fund({ id: '4', code: 'SMALL', nav: 9_000 })]
    expect(filterAndSortFunds(withSmall, { ...all, sortKey: 'nav' }).map((f) => f.nav))
      .toEqual([9_000, 10_000, 20_000, 30_000])
  })

  it('sorts by name', () => {
    expect(codes(filterAndSortFunds(funds, { ...all, sortKey: 'name' }))).toEqual(['BALAN', 'TCBF', 'VESAF'])
  })

  it('filters by fund type', () => {
    expect(codes(filterAndSortFunds(funds, { ...all, typeFilter: 'debt' }))).toEqual(['TCBF'])
  })

  it('searches code and name, case-insensitively', () => {
    expect(codes(filterAndSortFunds(funds, { ...all, query: 'vesaf' }))).toEqual(['VESAF'])
    expect(codes(filterAndSortFunds(funds, { ...all, query: 'bond' }))).toEqual(['TCBF'])
    expect(codes(filterAndSortFunds(funds, { ...all, query: 'BOND' }))).toEqual(['TCBF'])
  })

  it('applies the type filter and the search together', () => {
    expect(filterAndSortFunds(funds, { ...all, typeFilter: 'equity', query: 'bond' })).toEqual([])
  })

  it('does not mutate the input list', () => {
    const input = [...funds]
    filterAndSortFunds(input, { ...all, sortKey: 'nav', sortAsc: false })
    expect(codes(input)).toEqual(['VESAF', 'TCBF', 'BALAN'])
  })

  it('handles an empty library', () => {
    expect(filterAndSortFunds([], all)).toEqual([])
  })
})

describe('nextSort', () => {
  it('flips direction when the same column is clicked again', () => {
    expect(nextSort({ sortKey: 'code', sortAsc: true }, 'code')).toEqual({ sortKey: 'code', sortAsc: false })
    expect(nextSort({ sortKey: 'code', sortAsc: false }, 'code')).toEqual({ sortKey: 'code', sortAsc: true })
  })

  it('starts a new column ascending', () => {
    // Not "keep the previous direction" — a fresh column always reads top-down.
    expect(nextSort({ sortKey: 'code', sortAsc: false }, 'nav')).toEqual({ sortKey: 'nav', sortAsc: true })
  })
})

describe('type metadata', () => {
  it('offers every fund type except gold in the create/edit form', () => {
    // Gold is tracked via byType, not as a user-created fund.
    expect(FORM_TYPES).not.toContain('gold')
    expect(FORM_TYPES.sort()).toEqual(['balanced', 'debt', 'equity'])
  })

  it('has a label and colours for every fund type', () => {
    const types = Object.keys(TYPE_META)
    expect(types.sort()).toEqual(['balanced', 'debt', 'equity', 'gold'])
    types.forEach((t) => {
      const meta = TYPE_META[t as keyof typeof TYPE_META]
      expect(meta.label).toBeTruthy()
      expect(meta.labelVi).toBeTruthy()
      expect(meta.color).toBeTruthy()
      expect(meta.bg).toBeTruthy()
    })
  })

  it('offers "all" plus the non-gold types as filters', () => {
    expect(TYPE_FILTERS.map((f) => f.v)).toEqual(['all', 'equity', 'debt', 'balanced'])
  })
})
