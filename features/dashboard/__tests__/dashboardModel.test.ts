import { describe, it, expect } from 'vitest'
import { addDaysIso, todayIso } from '@/lib/dates'
import type { DashboardData, GoalData, NonFundUnallocatedItem, FundBreakdownItem } from '../contracts'
import {
  isDashboardEmpty,
  sortGoals,
  tagNonFunds,
  maturingCount,
  maturingDeposits,
  mergeClusterSummaries,
  goalSiblingInvRows,
  goalHeldSiblings,
  findFund,
  nonFundToInvRow,
  sellItemForFund,
  sellItemForMaturingDeposit,
  reportPreviewStats,
} from '../dashboardModel'

// The dashboard's derived view model, lifted out of DashboardClient (#602).
// These are the calculations the page used to do inline between its 30-odd
// useState calls: what counts as empty, which deposits need attention, which of
// a goal's siblings the merge sheet may fold in, what a sell sheet is handed.
// They are the parts that have actually carried bugs — the badge/card count
// disagreeing, a goal-split book counted twice — so they are tested here rather
// than through a full-page render.

const nonFund = (over: Partial<NonFundUnallocatedItem> = {}): NonFundUnallocatedItem => ({
  transactionId: 't1', type: 'bank', amount: 1_000_000, currentValue: 1_050_000,
  interestRate: 6, expiryDate: '2026-08-03', investmentDate: '2025-08-03',
  notes: null, units: null, depositGroupId: null, ...over,
})

const fund = (over: Partial<FundBreakdownItem> = {}): FundBreakdownItem => ({
  fundId: 'f1', fundName: 'VESAF', fundType: 'equity', quantity: 100,
  currentNAV: 20_000, currentValue: 2_000_000, purchasePrice: 1_800_000,
  costBasis: 1_800_000, profitLoss: 200_000, profitLossPercentage: 11.1, goalId: null,
  ...over,
})

const goal = (over: Partial<GoalData> = {}): GoalData => ({
  goalId: 'g1', goalName: 'Nhà', targetAmount: 100_000_000, targetDate: null,
  currentValue: 10_000_000, totalInvested: 9_000_000, profitLoss: 1_000_000,
  profitLossPercentage: 11.1, progressPercentage: 10, transactionCount: 3,
  funds: [], nonFunds: [], ...over,
})

const dash = (over: Partial<DashboardData> = {}): DashboardData => ({
  netWorth: {
    totalAssets: 0, totalLiabilities: 0, netWorth: 0, totalInvested: 0, currentValue: 0,
    overallProfitLoss: 0, overallProfitLossPercentage: 0, navStale: false, hasGold: false,
    navUpdatedAt: null,
  },
  goals: [], unallocated: { totalValue: 0, funds: [], nonFunds: [] },
  byType: { bank: 0, gold: 0, stock: 0 }, insurance: [], ...over,
})

describe('isDashboardEmpty', () => {
  it('is true only when there are no goals, no holdings and no insurance', () => {
    expect(isDashboardEmpty(dash())).toBe(true)
    expect(isDashboardEmpty(dash({ goals: [goal()] }))).toBe(false)
    expect(isDashboardEmpty(dash({ unallocated: { totalValue: 1, funds: [fund()], nonFunds: [] } }))).toBe(false)
    expect(isDashboardEmpty(dash({ unallocated: { totalValue: 1, funds: [], nonFunds: [nonFund()] } }))).toBe(false)
  })

  it('is false while data is still loading', () => {
    // `null` is "not known yet" — rendering the empty state then would flash the
    // onboarding CTA at every user on every cold load.
    expect(isDashboardEmpty(null)).toBe(false)
  })
})

describe('sortGoals', () => {
  const goals = [
    goal({ goalId: 'a', goalName: 'Xe', progressPercentage: 50 }),
    goal({ goalId: 'b', goalName: 'Nhà', progressPercentage: 10 }),
    goal({ goalId: 'c', goalName: 'Du lịch', progressPercentage: null }),
  ]

  it('leaves manual order untouched', () => {
    expect(sortGoals(goals, 'manual').map((g) => g.goalId)).toEqual(['a', 'b', 'c'])
  })

  it('orders by progress in both directions, treating null as 0', () => {
    expect(sortGoals(goals, 'progressDesc').map((g) => g.goalId)).toEqual(['a', 'b', 'c'])
    // 'c' has no target, so its null progress sorts as 0 — ahead of 'b' at 10%.
    expect(sortGoals(goals, 'progressAsc').map((g) => g.goalId)).toEqual(['c', 'b', 'a'])
  })

  it('orders alphabetically', () => {
    expect(sortGoals(goals, 'alpha').map((g) => g.goalName)).toEqual(['Du lịch', 'Nhà', 'Xe'])
  })

  it('sorts a finished goal by the percentage it was archived at (#650)', () => {
    // Its holdings were liquidated, so progressPercentage reads ~0. The cards
    // render the snapshot; the ordering has to agree with them.
    const finished = goal({
      goalId: 'done', goalName: 'Bếp', progressPercentage: 0,
      completedAt: '2026-08-13T02:00:00Z', completionValue: 50_000_000, completionPercentage: 100,
    })
    expect(sortGoals([...goals, finished], 'progressDesc').map((g) => g.goalId))
      .toEqual(['done', 'a', 'b', 'c'])
  })

  it('does not mutate the input', () => {
    const input = [...goals]
    sortGoals(input, 'alpha')
    expect(input.map((g) => g.goalId)).toEqual(['a', 'b', 'c'])
  })
})

describe('tagNonFunds', () => {
  it('tags each tranche with its goal bucket, unallocated ones with null', () => {
    const d = dash({
      goals: [goal({ goalId: 'g1', nonFunds: [nonFund({ transactionId: 'in-goal' })] })],
      unallocated: { totalValue: 0, funds: [], nonFunds: [nonFund({ transactionId: 'loose' })] },
    })
    expect(tagNonFunds(d).map((t) => [t.it.transactionId, t.goalId])).toEqual([
      ['in-goal', 'g1'],
      ['loose', null],
    ])
  })

  it('tolerates a goal with no nonFunds field (cached payloads)', () => {
    expect(tagNonFunds(dash({ goals: [goal({ nonFunds: undefined })] }))).toEqual([])
  })

  it('is empty for no data', () => {
    expect(tagNonFunds(null)).toEqual([])
  })
})

describe('maturingCount', () => {
  const matured = { expiryDate: '2020-01-01' }

  it('counts a term deposit once each', () => {
    const d = dash({ unallocated: { totalValue: 0, funds: [], nonFunds: [
      nonFund({ transactionId: 'a', ...matured }),
      nonFund({ transactionId: 'b', ...matured }),
    ] } })
    expect(maturingCount(tagNonFunds(d))).toBe(2)
  })

  it('counts an accumulating book ONCE even when its tranches sit in different goals', () => {
    // The bug this guards: the nav badge and the "needs attention" card each
    // tallied per-bucket, so a book mid-way through a goal cascade was
    // double-counted by one and missed by the other.
    const d = dash({
      goals: [
        goal({ goalId: 'g1', nonFunds: [nonFund({ transactionId: 'book', depositGroupId: 'book', ...matured })] }),
        goal({ goalId: 'g2', nonFunds: [nonFund({ transactionId: 'tranche2', depositGroupId: 'book', ...matured })] }),
      ],
    })
    expect(maturingCount(tagNonFunds(d))).toBe(1)
  })

  it('ignores deposits that are not yet due', () => {
    const d = dash({ unallocated: { totalValue: 0, funds: [], nonFunds: [
      nonFund({ expiryDate: '2099-01-01' }),
    ] } })
    expect(maturingCount(tagNonFunds(d))).toBe(0)
  })
})

describe('maturingDeposits', () => {
  it('agrees with maturingCount — the card and the badge cannot disagree', () => {
    const d = dash({
      goals: [goal({ goalId: 'g1', nonFunds: [
        nonFund({ transactionId: 'book', depositGroupId: 'book', expiryDate: '2020-01-01' }),
        nonFund({ transactionId: 'term', expiryDate: '2020-01-01' }),
      ] })],
    })
    const tagged = tagNonFunds(d)
    expect(maturingDeposits(tagged, false)).toHaveLength(maturingCount(tagged))
  })

  it('carries the goal context and the raw item for each row', () => {
    const d = dash({ goals: [goal({ goalId: 'g1', nonFunds: [nonFund({ transactionId: 'term', expiryDate: '2020-01-01' })] })] })
    const [dep] = maturingDeposits(tagNonFunds(d), false)
    expect(dep.goalId).toBe('g1')
    expect(dep.raw.transactionId).toBe('term')
    expect(dep.inv.id).toBe('term')
  })

  it('localises the fallback name for a deposit with no notes', () => {
    const d = dash({ unallocated: { totalValue: 0, funds: [], nonFunds: [nonFund({ notes: null, expiryDate: '2020-01-01' })] } })
    expect(maturingDeposits(tagNonFunds(d), true)[0].inv.name).toBe('Tiền gửi')
    expect(maturingDeposits(tagNonFunds(d), false)[0].inv.name).toBe('Bank deposit')
  })
})

describe('mergeClusterSummaries', () => {
  it('reports a cluster on the anchor when a goal has close-maturing deposits', () => {
    const d = dash({ goals: [goal({ goalId: 'g1', nonFunds: [
      nonFund({ transactionId: 'anchor', expiryDate: '2020-01-01' }),
      nonFund({ transactionId: 'sibling', expiryDate: '2020-01-05' }),
    ] })] })
    const clusters = mergeClusterSummaries(tagNonFunds(d))
    expect(clusters.length).toBeGreaterThan(0)
    expect(clusters[0].size).toBeGreaterThanOrEqual(2)
  })

  it('reports nothing when only ONE deposit is on the card (#651)', () => {
    // The card lists the due deposit alone; the other one matures well outside
    // the reminder window, so a "2 sổ đáo hạn sát nhau" banner would be a promise
    // the user cannot see the other half of.
    const soon = addDaysIso(todayIso(), 3) // inside the reminder window → on the card
    const later = addDaysIso(todayIso(), 9) // outside it, but 6 days from `soon`
    const d = dash({ goals: [goal({ goalId: 'g1', nonFunds: [
      nonFund({ transactionId: 'due', expiryDate: soon }),
      nonFund({ transactionId: 'not-yet', expiryDate: later }),
    ] })] })
    expect(maturingDeposits(tagNonFunds(d), false)).toHaveLength(1)
    expect(mergeClusterSummaries(tagNonFunds(d))).toEqual([])
  })

  it('reports nothing when no deposit is actionable yet', () => {
    const d = dash({ goals: [goal({ goalId: 'g1', nonFunds: [
      nonFund({ transactionId: 'a', expiryDate: '2099-01-01' }),
      nonFund({ transactionId: 'b', expiryDate: '2099-01-05' }),
    ] })] })
    expect(mergeClusterSummaries(tagNonFunds(d))).toEqual([])
  })
})

describe('goalSiblingInvRows', () => {
  const d = dash({ goals: [goal({ goalId: 'g1', nonFunds: [
    nonFund({ transactionId: 'anchor' }),
    nonFund({ transactionId: 'sibling' }),
    nonFund({ transactionId: 'gold-bar', type: 'gold' }),
  ] })] })

  it('returns the goal’s other BANK deposits only', () => {
    expect(goalSiblingInvRows(d, 'g1', 'anchor', false).map((r) => r.id)).toEqual(['sibling'])
  })

  it('is empty for an unassigned deposit — merge is goal-scoped', () => {
    expect(goalSiblingInvRows(d, null, 'anchor', false)).toEqual([])
  })

  it('is empty for no data or an unknown goal', () => {
    expect(goalSiblingInvRows(null, 'g1', 'anchor', false)).toEqual([])
    expect(goalSiblingInvRows(d, 'nope', 'anchor', false)).toEqual([])
  })
})

describe('goalHeldSiblings', () => {
  it('maps the goal’s pooled holdings for preselect', () => {
    const d = dash({ goals: [goal({ goalId: 'g1', heldForMerge: [
      { transactionId: 'h1', amount: 500_000, anchorInvId: null, name: 'Chờ gộp' },
    ] })] })
    expect(goalHeldSiblings(d, 'g1')).toEqual([{ id: 'h1', name: 'Chờ gộp', amount: 500_000 }])
  })

  it('is empty for an unassigned deposit and for a goal with no pool', () => {
    const d = dash({ goals: [goal({ goalId: 'g1' })] })
    expect(goalHeldSiblings(d, null)).toEqual([])
    expect(goalHeldSiblings(d, 'g1')).toEqual([])
  })
})

describe('findFund', () => {
  it('searches unallocated and every goal', () => {
    const d = dash({
      goals: [goal({ funds: [fund({ fundId: 'in-goal' })] })],
      unallocated: { totalValue: 0, funds: [fund({ fundId: 'loose' })], nonFunds: [] },
    })
    expect(findFund(d, 'in-goal')?.fundId).toBe('in-goal')
    expect(findFund(d, 'loose')?.fundId).toBe('loose')
    expect(findFund(d, 'missing')).toBeNull()
    expect(findFund(d, null)).toBeNull()
    expect(findFund(null, 'loose')).toBeNull()
  })
})

describe('nonFundToInvRow', () => {
  it('carries the merge-eligibility fields, and only reads bankCode for a bank', () => {
    const row = nonFundToInvRow(nonFund({ bankCode: 'VCB', currency: 'USD', isPledged: true }), false)
    expect(row).toMatchObject({ bankCode: 'VCB', currency: 'USD', isPledged: true })
    expect(nonFundToInvRow(nonFund({ type: 'gold', bankCode: 'VCB' }), false).bankCode).toBeNull()
  })

  // #659: MaturityResolveSheet gates its merge panel on this field, so a mapper
  // that silently drops it decides "no handover" for every row it produces.
  it('carries the successor promise through', () => {
    expect(nonFundToInvRow(nonFund({ successorDepositTxId: 'book-2' }), false).successorDepositTxId).toBe('book-2')
    expect(nonFundToInvRow(nonFund(), false).successorDepositTxId).toBeNull()
  })

  it('computes gain against the principal, and reports null when there is none', () => {
    expect(nonFundToInvRow(nonFund({ amount: 1_000_000, currentValue: 1_100_000 }), false).gainPct).toBeCloseTo(10)
    expect(nonFundToInvRow(nonFund({ amount: 0 }), false).gainPct).toBeNull()
  })
})

describe('sellItemForFund', () => {
  it('hands the sheet the cost basis a sale draws from, not the purchase price', () => {
    // #587: the sheet must refuse to take out more than the remaining basis.
    const item = sellItemForFund(fund({ purchasePrice: 1_800_000, costBasis: 900_000 }))
    expect(item).toMatchObject({ type: 'fund', fundId: 'f1', purchasePrice: 1_800_000, costBasis: 900_000 })
  })
})

describe('sellItemForMaturingDeposit', () => {
  const term = { inv: nonFundToInvRow(nonFund({ transactionId: 'term' }), false), goalId: null, raw: nonFund({ transactionId: 'term' }) }

  it('sells a single term deposit from its own row', () => {
    expect(sellItemForMaturingDeposit(term, false)).toMatchObject({ type: 'bank', transactionId: 'term' })
  })

  it('sells a whole book at its rolled-up total, not the anchor tranche’s value', () => {
    // Withdrawing a book is a full close: prefilling the anchor's value would
    // under-report the balance by every top-up.
    const anchor = nonFund({ transactionId: 'book', depositGroupId: 'book', currentValue: 1_000_000, amount: 1_000_000 })
    const rolled = { ...nonFundToInvRow(anchor, false), value: 3_000_000, principal: 2_800_000, depositGroupId: 'book' }
    const item = sellItemForMaturingDeposit({ inv: rolled, goalId: null, raw: anchor }, false)
    expect(item).toMatchObject({
      type: 'bank', transactionId: 'book', depositGroupId: 'book',
      currentValue: 3_000_000, purchasePrice: 2_800_000,
    })
  })
})

// The PDF renders every goal, a finished one as its completion snapshot (#650).
// A preview that counts only the active ones tells a portfolio of finished goals
// it has none, one tap before handing it a report full of them.
describe('reportPreviewStats', () => {
  const net = { netWorth: 50_000_000, currentValue: 40_000_000, overallProfitLoss: 2_000_000 }

  it('counts finished goals, because the report contains them', () => {
    const stats = reportPreviewStats(net, [
      goal({ goalId: 'done', completedAt: '2026-08-01T00:00:00Z', completionValue: 9_000_000, completionPercentage: 100 }),
    ])
    expect(stats.goalCount).toBe(1)
  })

  it('carries the net-worth figures through unchanged', () => {
    const stats = reportPreviewStats(net, [goal(), goal({ goalId: 'g2' })])
    expect(stats).toEqual({
      netWorth: 50_000_000, currentValue: 40_000_000, totalPL: 2_000_000, goalCount: 2,
    })
  })
})
