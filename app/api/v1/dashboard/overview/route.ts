import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { isNavStale, insuranceStatus, isPlanMonthRealized, isInCurrentCycle, realizedRecurringContributions } from '@/lib/finance'
import { buildWithdrawalMaps } from '@/lib/withdrawalProgress'
import { heldForMergeContributions } from '@/lib/heldForMerge'
import { valueNonFundHolding } from '@/lib/depositValuation'
import { persistSnapshot, shouldWriteSnapshot } from '@/lib/snapshots'
import { todayIso } from '@/lib/dates'

export const dynamic = 'force-dynamic'

// A non-fund holding (bank / gold / stock) as the dashboard exposes it, for both
// goal-assigned and unallocated buckets. Built only via `buildNonFund` so the two
// buckets can never drift — omitting a field in one branch (e.g. expiryDate,
// which the maturity card needs) is exactly the bug this factory prevents.
type NonFundEntry = {
  transactionId: string
  type: string
  amount: number
  currentValue: number
  interestRate: number | null
  expiryDate: string | null
  investmentDate: string
  units: number | null
  notes: string | null
  // Accumulating-book grouping: set on every tranche (anchor's = its own id).
  // The client groups holdings by it and excludes books from the maturity card.
  depositGroupId: string | null
  // Structured bank (FK) + currency + pledged flag — null/false on legacy
  // deposits. Carried for the merge provenance/destination picker and the
  // eligibility "same currency" / "not pledged" rules.
  bankCode: string | null
  currency: string | null
  isPledged: boolean
}

function buildNonFund(
  tx: { transaction_id: string; asset_type: string; interest_rate: number | null; expiry_date: string | null; investment_date: string; notes: string | null; deposit_group_id?: string | null; bank_code?: string | null; currency?: string | null; is_pledged?: boolean | null },
  amount: number,
  currentValue: number,
  units: number | null,
): NonFundEntry {
  return {
    transactionId: tx.transaction_id,
    type: tx.asset_type,
    amount,
    currentValue,
    interestRate: tx.interest_rate ?? null,
    expiryDate: tx.expiry_date ?? null,
    investmentDate: tx.investment_date,
    units,
    notes: tx.notes ?? null,
    depositGroupId: tx.deposit_group_id ?? null,
    bankCode: tx.bank_code ?? null,
    currency: tx.currency ?? null,
    isPledged: tx.is_pledged ?? false,
  }
}

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // The business day (Asia/Ho_Chi_Minh, see lib/dates) — used both to read the
  // existing snapshot below and to upsert it at the end. Derived in that zone,
  // not from the server's UTC clock, or a snapshot taken between 00:00 and 06:59
  // Vietnam time would be filed under the previous day (#591).
  const today = todayIso()
  // Pin interest accrual to UTC midnight so the displayed networth is stable
  // across multiple API calls within the same day. Using Date.now() makes
  // calcProjectedInterest return a slightly different value every millisecond —
  // visible as a number jump when the 2-min localStorage cache expires and a
  // fresh fetch returns a different value (issue #402).
  const valuationAsOf = new Date(today).getTime()

  const [plansRes, goalsRes, txRes, insuranceRes, insuranceSavingsRes, recSavingsRes, goldPriceRes, snapshotRes] = await Promise.all([
    supabase.from('monthly_plans').select('id, month, year').eq('user_id', user.id),
    supabase
      .from('savings_goals')
      .select('goal_id, goal_name, target_amount, target_date')
      .eq('user_id', user.id),
    supabase
      // Snapshot-free view — renewal history rows can't reach the net-worth /
      // goal / allocation totals (defence on top of the app-side filter below).
      .from('active_investment_transactions')
      .select('transaction_id, goal_id, amount_vnd, interest_rate, investment_date, asset_type, transaction_type, units, unit_price, units_withdrawn, principal_withdrawn, fund_id, parent_transaction_id, renewed_from_transaction_id, deposit_group_id, expiry_date, notes, affects_progress, bank_code, currency, is_pledged, held_for_merge, merge_target_goal_id, consumed_by_inv_id, funds(id, name, nav, updated_at, fund_type)')
      .eq('user_id', user.id),
    supabase
      .from('insurance_members')
      .select('member_id, member_name, relationship, annual_payment_vnd, payment_date, last_payment_date')
      .eq('user_id', user.id),
    supabase
      .from('insurance_savings')
      .select('insurance_member_id, amount_saved_vnd, saved_date, created_at')
      .eq('user_id', user.id),
    supabase
      .from('recurring_savings')
      .select('saving_id, goal_id, name, amount_vnd, effective_from, effective_to')
      .eq('user_id', user.id),
    supabase
      .from('gold_price_settings')
      .select('price_per_chi')
      .eq('user_id', user.id)
      .single(),
    supabase
      .from('net_worth_snapshots')
      .select('total_assets')
      .eq('user_id', user.id)
      .eq('snapshot_date', today)
      .maybeSingle(),
  ])

  const plans = (plansRes.data ?? []) as { id: string; month: number; year: number }[]
  const planIds = plans.map((p) => p.id)

  const [insExclusionsRes, insOverridesRes, recOverridesRes, recFulfillmentsRes] = await Promise.all([
    planIds.length > 0
      ? supabase.from('plan_excluded_insurance_members').select('plan_id, member_id').in('plan_id', planIds)
      : Promise.resolve({ data: [], error: null }),
    planIds.length > 0
      ? supabase.from('plan_insurance_member_overrides').select('plan_id, member_id, monthly_amount_override_vnd').in('plan_id', planIds)
      : Promise.resolve({ data: [], error: null }),
    planIds.length > 0
      ? supabase.from('recurring_saving_overrides').select('plan_id, recurring_saving_id, monthly_amount_override_vnd').in('plan_id', planIds)
      : Promise.resolve({ data: [], error: null }),
    // Months a recurring saving was settled by a maturity-combine renewal — used
    // to suppress its synthesized contribution (the amount lives in the deposit).
    supabase.from('recurring_saving_fulfillments').select('recurring_saving_id, ym').eq('user_id', user.id),
  ])

  // Every source below feeds the net-worth / contribution totals. A silent
  // failure here doesn't just understate the dashboard — because the computed
  // total is upserted into net_worth_snapshots at the end, a transient read
  // error would overwrite today's snapshot with an incomplete value, turning a
  // recoverable read failure into persisted financial-history corruption (#513).
  // So any required-source error fails the whole request with a 500 (which also
  // short-circuits before the snapshot write below).
  const requiredErrors = [
    plansRes.error,
    goalsRes.error,
    txRes.error,
    insuranceRes.error,
    insuranceSavingsRes.error,
    recSavingsRes.error,
    snapshotRes.error,
    insExclusionsRes.error,
    insOverridesRes.error,
    recOverridesRes.error,
    recFulfillmentsRes.error,
  ]
  // gold_price_settings uses .single(): a missing row surfaces as PGRST116 and
  // is legitimate (the user simply hasn't set a gold price → null, valued as 0).
  // Any other error is a real failure that would understate a gold holder's
  // total, so it IS required.
  if (goldPriceRes.error && goldPriceRes.error.code !== 'PGRST116') {
    requiredErrors.push(goldPriceRes.error)
  }
  if (requiredErrors.some(Boolean)) {
    return NextResponse.json({ error: 'Failed to fetch dashboard data' }, { status: 500 })
  }

  const goals = goalsRes.data ?? []
  const allTxsRaw = txRes.data ?? []

  // Separate investment vs withdrawal rows
  const investments = allTxsRaw.filter((tx) =>
    tx.transaction_type !== 'withdrawal' &&
    !tx.renewed_from_transaction_id && // exclude renewal snapshots (defence; the active_* view already does)
    !(tx.asset_type === 'fund' && tx.units == null) // exclude pending DCA-seeded fund rows
  )
  const withdrawals = allTxsRaw.filter((tx) => tx.transaction_type === 'withdrawal')

  // Two axes (see lib/withdrawalProgress): the …All maps drive VALUATION /
  // net worth (every withdrawal counts — the money left the holding); the
  // progress-filtered maps drive the goal bar (affects_progress=false held
  // steady). currentValue and progressValue below are computed independently
  // so a "doesn't count toward progress" withdrawal lowers net worth without
  // moving the bar — and the dashboard agrees with the goal-detail tab.
  const { parentWdMap, fundWdMap, parentWdMapAll, fundWdMapAll } = buildWithdrawalMaps(withdrawals)

  const insuranceMembers = insuranceRes.data ?? []
  const goldPricePerChi: number | null = goldPriceRes.data?.price_per_chi ?? null

  // Keep raw savings rows per member so each can be filtered to the member's
  // current premium cycle (savings made after its last settlement).
  const insuranceSavingsByMember = new Map<string, { amount: number; date: string }[]>()
  for (const s of (insuranceSavingsRes.data ?? [])) {
    const rows = insuranceSavingsByMember.get(s.insurance_member_id) ?? []
    // Fall back to created_at when saved_date is null, matching the savings
    // history endpoint so the "Saved" amount and history reconcile.
    rows.push({ amount: s.amount_saved_vnd ?? 0, date: String(s.saved_date ?? s.created_at ?? '') })
    insuranceSavingsByMember.set(s.insurance_member_id, rows)
  }

  const excludedSet = new Set<string>()
  for (const e of (insExclusionsRes.data ?? [])) {
    excludedSet.add(`${e.plan_id}::${e.member_id}`)
  }
  const overrideMap = new Map<string, number>()
  for (const o of (insOverridesRes.data ?? [])) {
    overrideMap.set(`${o.plan_id}::${o.member_id}`, o.monthly_amount_override_vnd)
  }

  let navStale = false
  let latestNavUpdatedAt: string | null = null

  const goalMap = new Map<string, {
    goalId: string
    goalName: string
    targetAmount: number | null
    targetDate: string | null
    currentValue: number
    // Progress numerator — equals currentValue except that affects_progress=false
    // withdrawals are added back, so the bar holds steady while net worth falls.
    progressValue: number
    totalInvested: number
    transactionCount: number
    funds: Array<{
      fundId: string
      fundName: string
      fundType: string
      quantity: number
      currentNAV: number
      currentValue: number
      purchasePrice: number
      // Remaining cost basis of this bucket (Σ amount_vnd, net of prior sells) — the
      // figure a sale must take out of it, surfaced so the sheets stop
      // reconstructing it from purchasePrice (#587, lib/fundWithdrawal).
      costBasis: number
      profitLoss: number
      profitLossPercentage: number
      goalId: string
    }>
    nonFunds: NonFundEntry[]
    // "Ví chờ gộp": settle-with-hold settlements still in the pool, surfaced so the
    // goal card can show a "đang chờ gộp" chip (with unhold) and the anchor's merge
    // sheet can preselect them. transactionId is the held WITHDRAWAL row.
    heldForMerge: Array<{ transactionId: string; amount: number; anchorInvId: string | null; name: string | null }>
  }>()

  for (const goal of goals) {
    goalMap.set(goal.goal_id, {
      goalId: goal.goal_id,
      goalName: goal.goal_name,
      targetAmount: goal.target_amount ?? null,
      targetDate: goal.target_date ?? null,
      currentValue: 0,
      progressValue: 0,
      totalInvested: 0,
      transactionCount: 0,
      funds: [],
      nonFunds: [],
      heldForMerge: [],
    })
  }

  // Aggregate fund transactions by goal+fund for P&L grouping
  type FundAccum = {
    fundId: string
    fundName: string
    fundType: string
    totalUnits: number
    totalInvested: number
    totalNavCost: number   // Σ(units × unit_price) — excludes fees, used for Avg Entry Price
    currentNAV: number
    navUpdatedAt: string
    goalId: string | null
  }
  const fundAccumMap = new Map<string, FundAccum>()

  // Track unallocated non-fund totals
  let unallocatedNonFundValue = 0
  let totalAssets = 0
  let totalInvestedGlobal = 0
  const nonFundByType: Record<string, number> = { bank: 0, gold: 0, stock: 0 }
  let goldUnits = 0  // total gold holdings in chỉ (after withdrawals)

  const unallocatedNonFunds: NonFundEntry[] = []

  for (const tx of investments) {
    if (tx.asset_type === 'fund' && tx.units) {
      const fund = Array.isArray(tx.funds)
        ? tx.funds[0] as { id: string; name: string; nav: number; updated_at: string; fund_type: string } | undefined
        : tx.funds as { id: string; name: string; nav: number; updated_at: string; fund_type: string } | null
      if (!fund) continue

      if (isNavStale(fund.updated_at)) navStale = true
      if (!latestNavUpdatedAt || fund.updated_at > latestNavUpdatedAt) latestNavUpdatedAt = fund.updated_at

      if (tx.goal_id && goalMap.has(tx.goal_id)) {
        goalMap.get(tx.goal_id)!.transactionCount += 1
      }

      const key = `${tx.goal_id ?? 'unallocated'}::${fund.id}`
      const existing = fundAccumMap.get(key)
      if (existing) {
        existing.totalUnits += tx.units
        existing.totalInvested += tx.amount_vnd
        existing.totalNavCost += tx.units * (tx.unit_price ?? 0)
      } else {
        fundAccumMap.set(key, {
          fundId: fund.id,
          fundName: fund.name,
          fundType: fund.fund_type,
          totalUnits: tx.units,
          totalInvested: tx.amount_vnd,
          totalNavCost: tx.units * (tx.unit_price ?? 0),
          currentNAV: fund.nav,
          navUpdatedAt: fund.updated_at,
          goalId: tx.goal_id ?? null,
        })
      }
    } else {
      // bank / stock / gold — apply any partial withdrawals. Shared, unit-tested
      // valuation so renewal re-parenting can't double-count a withdrawal here.
      // Value twice: parentWdMapAll (every withdrawal → net worth) and parentWdMap
      // (progress-affecting only → goal bar). They differ only when the holding
      // has an affects_progress=false withdrawal, which net worth must subtract
      // but the bar must not.
      const valued = valueNonFundHolding(tx, parentWdMapAll, goldPricePerChi, valuationAsOf)
      const progValued = valueNonFundHolding(tx, parentWdMap, goldPricePerChi, valuationAsOf)
      // The bar holds the value any affects_progress=false withdrawal removed,
      // even after the holding is fully gone from net worth.
      const progressContribution = progValued?.currentValue ?? 0
      if (tx.goal_id && goalMap.has(tx.goal_id)) {
        goalMap.get(tx.goal_id)!.progressValue += progressContribution
      }

      if (!valued) continue // fully withdrawn / sold (net worth)
      const { effectiveAmount, currentValue, effectiveUnits } = valued

      totalAssets += currentValue
      totalInvestedGlobal += effectiveAmount
      if (tx.asset_type in nonFundByType) nonFundByType[tx.asset_type] += currentValue
      if (tx.asset_type === 'gold' && effectiveUnits != null && effectiveUnits > 0) {
        goldUnits += effectiveUnits
      }

      if (tx.goal_id && goalMap.has(tx.goal_id)) {
        const goalEntry = goalMap.get(tx.goal_id)!
        goalEntry.totalInvested += effectiveAmount
        goalEntry.currentValue += currentValue
        goalEntry.transactionCount += 1
        goalEntry.nonFunds.push(buildNonFund(tx, effectiveAmount, currentValue, effectiveUnits))
      } else {
        unallocatedNonFundValue += currentValue
        unallocatedNonFunds.push(buildNonFund(tx, effectiveAmount, currentValue, effectiveUnits))
      }
    }
  }

  // Fund progress contribution (goal bar): value the units left after only the
  // progress-affecting sells. Computed from the gross accumulators BEFORE the
  // net-worth subtraction below, and added even when the fund is fully sold for
  // net worth — an affects_progress=false sell holds the bar steady.
  for (const [key, acc] of fundAccumMap) {
    if (!acc.goalId || !goalMap.has(acc.goalId)) continue
    const progUnits = acc.totalUnits - (fundWdMap.get(key)?.units ?? 0)
    if (progUnits > 0) goalMap.get(acc.goalId)!.progressValue += acc.currentNAV * progUnits
  }

  // Subtract ALL fund sell withdrawals from fund accumulators for valuation /
  // net worth — the units are gone regardless of affects_progress.
  for (const [key, wd] of fundWdMapAll) {
    const acc = fundAccumMap.get(key)
    if (!acc || wd.units <= 0) continue
    const totalUnitsBefore = acc.totalUnits
    acc.totalNavCost -= totalUnitsBefore > 0 ? (wd.units / totalUnitsBefore) * acc.totalNavCost : 0
    acc.totalUnits -= wd.units
    acc.totalInvested -= wd.cost
  }

  // Convert fund accumulators to breakdown items
  const unallocatedFunds: Array<{
    fundId: string; fundName: string; fundType: string; quantity: number; currentNAV: number
    currentValue: number; purchasePrice: number; costBasis: number; profitLoss: number; profitLossPercentage: number; goalId: null
  }> = []
  let unallocatedFundValue = 0

  for (const [, acc] of fundAccumMap) {
    if (acc.totalUnits <= 0) continue // fully sold
    const currentValue = acc.currentNAV * acc.totalUnits
    const profitLoss = currentValue - acc.totalInvested
    const profitLossPercentage = acc.totalInvested > 0 ? (profitLoss / acc.totalInvested) * 100 : 0
    const purchasePrice = acc.totalUnits > 0 ? acc.totalNavCost / acc.totalUnits : 0

    totalAssets += currentValue
    totalInvestedGlobal += acc.totalInvested

    const fundItem = {
      fundId: acc.fundId,
      fundName: acc.fundName,
      fundType: acc.fundType,
      quantity: acc.totalUnits,
      currentNAV: acc.currentNAV,
      currentValue,
      purchasePrice,
      costBasis: Math.round(acc.totalInvested),
      profitLoss,
      profitLossPercentage,
      goalId: acc.goalId,
    }

    if (acc.goalId && goalMap.has(acc.goalId)) {
      const goalEntry = goalMap.get(acc.goalId)!
      goalEntry.currentValue += currentValue
      goalEntry.totalInvested += acc.totalInvested
      goalEntry.funds.push({ ...fundItem, goalId: acc.goalId })
    } else {
      unallocatedFunds.push({ ...fundItem, goalId: null })
      unallocatedFundValue += currentValue
    }
  }

  // Recurring savings count once the month they apply to has arrived (real-saved
  // model, mirroring insurance). There is no investment_transactions row for
  // these, so add them straight to the running totals. Equal amounts go to value
  // and invested (no growth modeled), keeping P&L neutral. They count toward net
  // worth (totalAssets, the bank asset-type bucket, and global invested) and,
  // when allocated, toward their goal. They are intentionally NOT added to the
  // Unallocated "available to assign" card — these are plan-driven balances, not
  // loose holdings that can be assigned or sold from there.
  // Real bank deposits already counted via the holdings aggregation above. When
  // one matches a recurring saving (month + goal + amount), suppress the
  // synthesized contribution so it isn't double-counted into net worth / goals.
  const loggedRecurringDeposits = investments
    .filter((tx) => tx.asset_type === 'bank')
    .map((tx) => ({
      month: String(tx.investment_date).slice(0, 7),
      goalId: tx.goal_id,
      amount: tx.amount_vnd,
    }))
  const recContributions = realizedRecurringContributions(
    recSavingsRes.data ?? [],
    plans,
    recOverridesRes.data ?? [],
    loggedRecurringDeposits,
    recFulfillmentsRes.data ?? [],
  )
  for (const c of recContributions) {
    totalAssets += c.amount
    totalInvestedGlobal += c.amount
    nonFundByType.bank += c.amount
    if (c.goalId && goalMap.has(c.goalId)) {
      const g = goalMap.get(c.goalId)!
      g.currentValue += c.amount
      g.progressValue += c.amount // no withdrawals involved — counts toward the bar too
      g.totalInvested += c.amount
      g.transactionCount += 1
    }
  }

  // "Ví chờ gộp" (merge holding pool): a settle-with-hold closed an earlier-
  // maturing deposit (its withdrawal already removed the principal from net worth
  // AND the bar above), but the cash is parked for a future merge. Add each
  // still-pooled holding back to its target goal so the value never dips — exactly
  // like recurring contributions, and for the same reason there is no deposit row
  // to count it. A consumed holding (merge done) is skipped: its cash now lives in
  // the renewed deposit's principal, already counted in the holdings pass.
  const heldContributions = heldForMergeContributions(withdrawals)
  // The held WITHDRAWAL has no name of its own — its label is the source deposit
  // it closed (parent_transaction_id). Map every active row's id → notes so the
  // chip can read "Sổ VCB 3 th." rather than a bare amount.
  const nameById = new Map<string, string | null>()
  for (const tx of allTxsRaw) nameById.set(tx.transaction_id, tx.notes ?? null)
  const wById = new Map(withdrawals.map((w) => [w.transaction_id, w]))
  for (const h of heldContributions) {
    totalAssets += h.amount
    totalInvestedGlobal += h.amount
    nonFundByType.bank += h.amount
    if (goalMap.has(h.goalId)) {
      const g = goalMap.get(h.goalId)!
      g.currentValue += h.amount
      g.progressValue += h.amount
      g.totalInvested += h.amount
      const parentId = wById.get(h.transactionId)?.parent_transaction_id ?? null
      g.heldForMerge.push({
        transactionId: h.transactionId,
        amount: h.amount,
        anchorInvId: h.anchorInvId,
        name: parentId ? nameById.get(parentId) ?? null : null,
      })
    }
  }

  const goalsOutput = Array.from(goalMap.values()).map((g) => {
    const profitLoss = g.currentValue - g.totalInvested
    const profitLossPercentage = g.totalInvested > 0 ? (profitLoss / g.totalInvested) * 100 : 0
    // Progress runs off progressValue, not currentValue: affects_progress=false
    // withdrawals lower net worth (currentValue) but are added back here so the
    // bar holds steady (see the withdrawal-map split above).
    const progressPercentage = g.targetAmount && g.targetAmount > 0
      ? Math.min((g.progressValue / g.targetAmount) * 100, 100)
      : null

    return {
      goalId: g.goalId,
      goalName: g.goalName,
      targetAmount: g.targetAmount,
      targetDate: g.targetDate,
      currentValue: g.currentValue,
      // Surfaced so the goal card/hero can reconcile the bar (progress) against
      // net worth (currentValue) when an affects_progress=false withdrawal makes
      // them diverge — see ProgressCreditNote.
      progressValue: g.progressValue,
      totalInvested: g.totalInvested,
      profitLoss,
      profitLossPercentage,
      progressPercentage,
      transactionCount: g.transactionCount,
      funds: g.funds,
      nonFunds: g.nonFunds,
      heldForMerge: g.heldForMerge,
    }
  })

  const insuranceOutput = insuranceMembers.map((m) => {
    const annualPremium = m.annual_payment_vnd
    const lastPaymentDate = m.last_payment_date ?? null
    const defaultMonthly = Math.round(annualPremium / 12)
    // Saved toward the CURRENT cycle only: logged contributions + plan
    // allocations for months that have arrived — both limited to dates after the
    // last settlement, so progress resets once a premium is marked paid.
    const lumpSumSaved = (insuranceSavingsByMember.get(m.member_id) ?? []).reduce(
      (sum, s) => (isInCurrentCycle(s.date, lastPaymentDate) ? sum + s.amount : sum), 0)
    const monthlySavedFromPlanning = plans.reduce((sum, p) => {
      if (excludedSet.has(`${p.id}::${m.member_id}`)) return sum
      if (!isPlanMonthRealized(p.year, p.month)) return sum
      const planMonthStart = `${p.year}-${String(p.month).padStart(2, '0')}-01`
      if (!isInCurrentCycle(planMonthStart, lastPaymentDate)) return sum
      return sum + (overrideMap.get(`${p.id}::${m.member_id}`) ?? defaultMonthly)
    }, 0)
    const amountSaved = lumpSumSaved + monthlySavedFromPlanning
    const savingsProgressPercentage = annualPremium > 0 ? (amountSaved / annualPremium) * 100 : 0
    const status = insuranceStatus(m.payment_date, m.last_payment_date)

    return {
      insuranceId: m.member_id,
      insuranceName: m.member_name,
      // Read relationship — the column both the add & edit forms actually write
      // (coverage_type was added for display but never populated).
      coverageType: m.relationship ?? null,
      annualPremium,
      amountSaved,
      savingsProgressPercentage,
      status,
      nextPaymentDate: m.payment_date ?? null,
      lastPaymentDate: m.last_payment_date ?? null,
    }
  })

  const totalLiabilities = 0
  const netWorth = totalAssets - totalLiabilities
  const overallProfitLoss = totalAssets - totalInvestedGlobal
  const overallProfitLossPercentage = totalInvestedGlobal > 0
    ? (overallProfitLoss / totalInvestedGlobal) * 100
    : 0

  const hasGold = allTxsRaw.some((tx) => tx.asset_type === 'gold')

  // Upsert today's snapshot for the history chart, but only when the rounded
  // value actually changed. The dashboard is loaded many times a day; re-writing
  // an identical row just burns disk I/O (WAL + dirtied page + autovacuum) for no
  // benefit. See lib/snapshots.ts.
  //
  // The write is awaited (with a timeout) so a serverless instance can't freeze
  // before the row lands — but it never fails the response: history is secondary
  // to the numbers on screen, so a broken write is logged, not surfaced (#592).
  if (shouldWriteSnapshot(snapshotRes.data, totalAssets)) {
    const written = await persistSnapshot(() =>
      supabase.from('net_worth_snapshots').upsert(
        { user_id: user.id, snapshot_date: today, total_assets: Math.round(totalAssets) },
        { onConflict: 'user_id,snapshot_date' }
      )
    )
    if (!written.ok) {
      // Context only — never the balance itself.
      console.error('[dashboard/overview] net-worth snapshot write failed', {
        user_id: user.id,
        snapshot_date: today,
        reason: written.reason,
      })
    }
  }

  return NextResponse.json({
    netWorth: {
      totalAssets,
      totalLiabilities,
      netWorth,
      totalInvested: totalInvestedGlobal,
      currentValue: totalAssets,
      overallProfitLoss,
      overallProfitLossPercentage,
      navStale,
      hasGold,
      navUpdatedAt: latestNavUpdatedAt,
    },
    goals: goalsOutput,
    unallocated: {
      totalValue: unallocatedFundValue + unallocatedNonFundValue,
      funds: unallocatedFunds,
      nonFunds: unallocatedNonFunds,
    },
    byType: nonFundByType,
    goldUnits,
    insurance: insuranceOutput,
  })
}
