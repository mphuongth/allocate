import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

// 1 business day = 1 day for simplicity (excludes weekends would need more logic)
function isNavStale(updatedAt: string): boolean {
  const updated = new Date(updatedAt)
  const now = new Date()
  const diffMs = now.getTime() - updated.getTime()
  const diffDays = diffMs / (1000 * 60 * 60 * 24)
  return diffDays > 1
}

function calcProjectedInterest(amount: number, rate: number | null, investmentDate: string): number {
  if (!rate) return 0
  const months = Math.max(0, Math.floor(
    (Date.now() - new Date(investmentDate).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
  ))
  return amount * Math.pow(1 + rate / 100 / 12, months) - amount
}

function insuranceStatus(paymentDate: string | null): 'on_track' | 'upcoming' | 'overdue' | 'completed' {
  if (!paymentDate) return 'on_track'
  const payment = new Date(paymentDate)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const thirtyDaysLater = new Date(today)
  thirtyDaysLater.setDate(today.getDate() + 30)

  if (payment < today) return 'overdue'
  if (payment <= thirtyDaysLater) return 'upcoming'
  return 'on_track'
}

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetch all data in parallel
  const [goalsRes, investmentsRes, insuranceRes, txRes, plansRes, insuranceSavingsRes] = await Promise.all([
    supabase
      .from('savings_goals')
      .select('goal_id, goal_name, target_amount')
      .eq('user_id', user.id),
    supabase
      .from('fund_investments')
      .select('id, goal_id, amount_vnd, units_purchased, nav_at_purchase, funds(id, name, nav, updated_at)')
      .eq('user_id', user.id),
    supabase
      .from('insurance_members')
      .select('member_id, member_name, coverage_type, annual_payment_vnd, payment_date')
      .eq('user_id', user.id),
    supabase
      .from('investment_transactions')
      .select('goal_id, amount_vnd, interest_rate, investment_date, asset_type, units, unit_price, fund_id, funds(id, name, nav, updated_at)')
      .eq('user_id', user.id)
      .not('goal_id', 'is', null),
    supabase
      .from('monthly_plans')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),
    supabase
      .from('insurance_savings')
      .select('insurance_member_id, amount_saved_vnd')
      .eq('user_id', user.id),
  ])

  if (goalsRes.error || investmentsRes.error || insuranceRes.error) {
    return NextResponse.json({ error: 'Failed to fetch dashboard data' }, { status: 500 })
  }

  const goals = goalsRes.data ?? []
  const investments = investmentsRes.data ?? []
  const insuranceMembers = insuranceRes.data ?? []
  const savingsTxs = txRes.data ?? []
  const monthlyPlanCount = plansRes.count ?? 0

  // Aggregate insurance lump sums by member
  const insuranceLumpSumMap = new Map<string, number>()
  for (const s of (insuranceSavingsRes.data ?? [])) {
    const prev = insuranceLumpSumMap.get(s.insurance_member_id) ?? 0
    insuranceLumpSumMap.set(s.insurance_member_id, prev + (s.amount_saved_vnd ?? 0))
  }

  // Detect stale NAV
  let navStale = false

  // Build per-goal aggregations
  const goalMap = new Map<string, {
    goalId: string
    goalName: string
    targetAmount: number | null
    currentValue: number
    totalInvested: number
    funds: Array<{
      fundId: string
      fundName: string
      quantity: number
      currentNAV: number
      currentValue: number
      purchasePrice: number
      profitLoss: number
      profitLossPercentage: number
      goalId: string
    }>
  }>()

  // Initialize goal map from goals table (includes goals with zero investments)
  for (const goal of goals) {
    goalMap.set(goal.goal_id, {
      goalId: goal.goal_id,
      goalName: goal.goal_name,
      targetAmount: goal.target_amount ?? null,
      currentValue: 0,
      totalInvested: 0,
      funds: [],
    })
  }

  // Aggregate investment_transactions (bank/stock/gold/fund) into goals
  let savingsTotalInvested = 0
  let savingsTotalCurrentValue = 0

  for (const tx of savingsTxs) {
    if (!tx.goal_id || !goalMap.has(tx.goal_id)) continue

    let currentValue: number
    if (tx.asset_type === 'fund' && tx.units) {
      // Fund transactions: use current NAV × units for real P&L
      const fund = Array.isArray(tx.funds)
        ? tx.funds[0] as { id: string; nav: number; updated_at: string } | undefined
        : tx.funds as { id: string; nav: number; updated_at: string } | null
      const currentNAV = fund?.nav ?? tx.unit_price ?? 0
      currentValue = tx.units * currentNAV
      if (fund?.updated_at && isNavStale(fund.updated_at)) navStale = true
    } else {
      // Bank/stock/gold: amount + projected compound interest
      const interest = calcProjectedInterest(tx.amount_vnd, tx.interest_rate, tx.investment_date)
      currentValue = tx.amount_vnd + interest
    }

    const goalEntry = goalMap.get(tx.goal_id)!
    goalEntry.totalInvested += tx.amount_vnd
    goalEntry.currentValue += currentValue
    savingsTotalInvested += tx.amount_vnd
    savingsTotalCurrentValue += currentValue
  }

  // Process investments — group by fund within each goal (aggregate multiple purchases of same fund)
  type FundAccum = {
    fundId: string
    fundName: string
    totalUnits: number
    totalInvested: number
    currentNAV: number
    navUpdatedAt: string
    goalId: string | null
  }
  const fundAccumMap = new Map<string, FundAccum>()

  for (const inv of investments) {
    const fund = Array.isArray(inv.funds) ? inv.funds[0] as { id: string; name: string; nav: number; updated_at: string } : inv.funds as { id: string; name: string; nav: number; updated_at: string } | null
    if (!fund) continue

    const key = `${inv.goal_id ?? 'unallocated'}::${fund.id}`
    const existing = fundAccumMap.get(key)
    if (existing) {
      existing.totalUnits += inv.units_purchased
      existing.totalInvested += inv.amount_vnd
    } else {
      fundAccumMap.set(key, {
        fundId: fund.id,
        fundName: fund.name,
        totalUnits: inv.units_purchased,
        totalInvested: inv.amount_vnd,
        currentNAV: fund.nav,
        navUpdatedAt: fund.updated_at,
        goalId: inv.goal_id ?? null,
      })
    }

    if (isNavStale(fund.updated_at)) navStale = true
  }

  // Convert accumulated funds to breakdown items and assign to goals or unallocated
  const unallocatedFunds: Array<{
    fundId: string; fundName: string; quantity: number; currentNAV: number
    currentValue: number; purchasePrice: number; profitLoss: number; profitLossPercentage: number; goalId: null
  }> = []
  let unallocatedTotal = 0
  let totalAssets = 0
  let totalInvestedGlobal = 0

  for (const [, acc] of fundAccumMap) {
    const currentValue = acc.currentNAV * acc.totalUnits
    const profitLoss = currentValue - acc.totalInvested
    const profitLossPercentage = acc.totalInvested > 0 ? (profitLoss / acc.totalInvested) * 100 : 0
    const purchasePrice = acc.totalUnits > 0 ? acc.totalInvested / acc.totalUnits : 0

    totalAssets += currentValue
    totalInvestedGlobal += acc.totalInvested

    const fundItem = {
      fundId: acc.fundId,
      fundName: acc.fundName,
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
      unallocatedTotal += currentValue
    }
  }

  // Build goals array with P&L and progress
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
      funds: g.funds,
    }
  })

  // Insurance
  const insuranceOutput = insuranceMembers.map((m) => {
    const annualPremium = m.annual_payment_vnd
    const lumpSumSaved = insuranceLumpSumMap.get(m.member_id) ?? 0
    const monthlySavedFromPlanning = monthlyPlanCount * Math.round(annualPremium / 12)
    const amountSaved = lumpSumSaved + monthlySavedFromPlanning
    const savingsProgressPercentage = annualPremium > 0 ? (amountSaved / annualPremium) * 100 : 0
    const status = insuranceStatus(m.payment_date)

    return {
      insuranceId: m.member_id,
      insuranceName: m.member_name,
      coverageType: m.coverage_type ?? null,
      annualPremium,
      amountSaved,
      savingsProgressPercentage,
      status,
      nextPaymentDate: m.payment_date ?? null,
    }
  })

  // Include savings transactions in global totals
  totalAssets += savingsTotalCurrentValue
  totalInvestedGlobal += savingsTotalInvested

  // Net worth (no liabilities tracked yet — set to 0)
  const totalLiabilities = 0
  const netWorth = totalAssets - totalLiabilities
  const overallProfitLoss = totalAssets - totalInvestedGlobal
  const overallProfitLossPercentage = totalInvestedGlobal > 0
    ? (overallProfitLoss / totalInvestedGlobal) * 100
    : 0

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
    },
    goals: goalsOutput,
    unallocated: {
      totalValue: unallocatedTotal,
      funds: unallocatedFunds,
    },
    insurance: insuranceOutput,
  })
}
