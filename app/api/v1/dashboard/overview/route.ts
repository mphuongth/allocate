import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { calcProjectedInterest, isNavStale, insuranceStatus } from '@/lib/finance'
import { buildWithdrawalMaps } from '@/lib/withdrawalProgress'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [plansRes, goalsRes, txRes, insuranceRes, insuranceSavingsRes, goldPriceRes] = await Promise.all([
    supabase.from('monthly_plans').select('id').eq('user_id', user.id),
    supabase
      .from('savings_goals')
      .select('goal_id, goal_name, target_amount')
      .eq('user_id', user.id),
    supabase
      .from('investment_transactions')
      .select('transaction_id, goal_id, amount_vnd, interest_rate, investment_date, asset_type, transaction_type, units, unit_price, units_withdrawn, principal_withdrawn, fund_id, parent_transaction_id, expiry_date, notes, affects_progress, funds(id, name, nav, updated_at, fund_type)')
      .eq('user_id', user.id),
    supabase
      .from('insurance_members')
      .select('member_id, member_name, coverage_type, annual_payment_vnd, payment_date, last_payment_date')
      .eq('user_id', user.id),
    supabase
      .from('insurance_savings')
      .select('insurance_member_id, amount_saved_vnd')
      .eq('user_id', user.id),
    supabase
      .from('gold_price_settings')
      .select('price_per_chi')
      .eq('user_id', user.id)
      .single(),
  ])

  const planIds = (plansRes.data ?? []).map((p: { id: string }) => p.id)

  const [insExclusionsRes, insOverridesRes] = await Promise.all([
    planIds.length > 0
      ? supabase.from('plan_excluded_insurance_members').select('plan_id, member_id').in('plan_id', planIds)
      : Promise.resolve({ data: [], error: null }),
    planIds.length > 0
      ? supabase.from('plan_insurance_member_overrides').select('plan_id, member_id, monthly_amount_override_vnd').in('plan_id', planIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (goalsRes.error || txRes.error || insuranceRes.error) {
    return NextResponse.json({ error: 'Failed to fetch dashboard data' }, { status: 500 })
  }

  const goals = goalsRes.data ?? []
  const allTxsRaw = txRes.data ?? []

  // Separate investment vs withdrawal rows
  const investments = allTxsRaw.filter((tx) =>
    tx.transaction_type !== 'withdrawal' &&
    !(tx.asset_type === 'fund' && tx.units == null) // exclude pending DCA-seeded fund rows
  )
  const withdrawals = allTxsRaw.filter((tx) => tx.transaction_type === 'withdrawal')

  const { parentWdMap, fundWdMap } = buildWithdrawalMaps(withdrawals)

  const insuranceMembers = insuranceRes.data ?? []
  const goldPricePerChi: number | null = goldPriceRes.data?.price_per_chi ?? null

  const insuranceLumpSumMap = new Map<string, number>()
  for (const s of (insuranceSavingsRes.data ?? [])) {
    const prev = insuranceLumpSumMap.get(s.insurance_member_id) ?? 0
    insuranceLumpSumMap.set(s.insurance_member_id, prev + (s.amount_saved_vnd ?? 0))
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
    currentValue: number
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
      profitLoss: number
      profitLossPercentage: number
      goalId: string
    }>
  }>()

  for (const goal of goals) {
    goalMap.set(goal.goal_id, {
      goalId: goal.goal_id,
      goalName: goal.goal_name,
      targetAmount: goal.target_amount ?? null,
      currentValue: 0,
      totalInvested: 0,
      transactionCount: 0,
      funds: [],
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

  const unallocatedNonFunds: {
    transactionId: string; type: string; amount: number; currentValue: number; interestRate: number | null; expiryDate: string | null; investmentDate: string; notes: string | null; units: number | null
  }[] = []

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
      // bank / stock / gold — apply any partial withdrawals
      const wd = parentWdMap.get(tx.transaction_id)
      const withdrawnPrincipal = wd?.principal ?? 0
      const withdrawnUnits = wd?.units ?? 0

      let currentValue: number
      let effectiveAmount: number
      let effectiveUnits: number | null = tx.units ?? null

      if (tx.asset_type === 'gold' && goldPricePerChi && tx.units) {
        effectiveUnits = tx.units - withdrawnUnits
        if (effectiveUnits <= 0) continue // fully sold
        currentValue = effectiveUnits * goldPricePerChi
        effectiveAmount = tx.amount_vnd - withdrawnPrincipal
      } else {
        effectiveAmount = tx.amount_vnd - withdrawnPrincipal
        if (effectiveAmount <= 0) continue // fully withdrawn
        const interest = calcProjectedInterest(effectiveAmount, tx.interest_rate, tx.investment_date, tx.expiry_date)
        currentValue = effectiveAmount + interest
      }

      totalAssets += currentValue
      totalInvestedGlobal += effectiveAmount
      if (tx.asset_type in nonFundByType) nonFundByType[tx.asset_type] += currentValue

      if (tx.goal_id && goalMap.has(tx.goal_id)) {
        const goalEntry = goalMap.get(tx.goal_id)!
        goalEntry.totalInvested += effectiveAmount
        goalEntry.currentValue += currentValue
        goalEntry.transactionCount += 1
      } else {
        unallocatedNonFundValue += currentValue
        unallocatedNonFunds.push({
          transactionId: tx.transaction_id,
          type: tx.asset_type,
          amount: effectiveAmount,
          currentValue,
          interestRate: tx.interest_rate ?? null,
          expiryDate: tx.expiry_date ?? null,
          investmentDate: tx.investment_date,
          notes: tx.notes ?? null,
          units: effectiveUnits,
        })
      }
    }
  }

  // Subtract fund sell withdrawals from fund accumulators
  for (const [key, wd] of fundWdMap) {
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
    currentValue: number; purchasePrice: number; profitLoss: number; profitLossPercentage: number; goalId: null
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

  const goalsOutput = Array.from(goalMap.values()).map((g) => {
    const profitLoss = g.currentValue - g.totalInvested
    const profitLossPercentage = g.totalInvested > 0 ? (profitLoss / g.totalInvested) * 100 : 0
    const progressPercentage = g.targetAmount && g.targetAmount > 0
      ? Math.min((g.currentValue / g.targetAmount) * 100, 100)
      : null

    return {
      goalId: g.goalId,
      goalName: g.goalName,
      targetAmount: g.targetAmount,
      currentValue: g.currentValue,
      totalInvested: g.totalInvested,
      profitLoss,
      profitLossPercentage,
      progressPercentage,
      transactionCount: g.transactionCount,
      funds: g.funds,
    }
  })

  const insuranceOutput = insuranceMembers.map((m) => {
    const annualPremium = m.annual_payment_vnd
    const lumpSumSaved = insuranceLumpSumMap.get(m.member_id) ?? 0
    const defaultMonthly = Math.round(annualPremium / 12)
    const monthlySavedFromPlanning = planIds.reduce((sum, planId) => {
      if (excludedSet.has(`${planId}::${m.member_id}`)) return sum
      return sum + (overrideMap.get(`${planId}::${m.member_id}`) ?? defaultMonthly)
    }, 0)
    const amountSaved = lumpSumSaved + monthlySavedFromPlanning
    const savingsProgressPercentage = annualPremium > 0 ? (amountSaved / annualPremium) * 100 : 0
    const baseStatus = insuranceStatus(m.payment_date)
    const status: 'on_track' | 'upcoming' | 'overdue' | 'completed' | 'ready' =
      amountSaved >= annualPremium && (baseStatus === 'on_track' || baseStatus === 'upcoming')
        ? 'ready'
        : baseStatus

    return {
      insuranceId: m.member_id,
      insuranceName: m.member_name,
      coverageType: m.coverage_type ?? null,
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

  // Upsert today's snapshot for the history chart (fire-and-forget)
  const today = new Date().toISOString().split('T')[0]
  supabase.from('net_worth_snapshots').upsert(
    { user_id: user.id, snapshot_date: today, total_assets: Math.round(totalAssets) },
    { onConflict: 'user_id,snapshot_date' }
  ).then(() => { /* ignore errors */ })

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
    insurance: insuranceOutput,
  })
}
