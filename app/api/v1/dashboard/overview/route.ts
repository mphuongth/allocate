import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'

function isNavStale(updatedAt: string): boolean {
  const updated = new Date(updatedAt)
  const now = new Date()
  const diffMs = now.getTime() - updated.getTime()
  const diffDays = diffMs / (1000 * 60 * 60 * 24)
  return diffDays > 1
}

function calcProjectedInterest(amount: number, rate: number | null, investmentDate: string, expiryDate?: string | null): number {
  if (!rate) return 0
  const endMs = expiryDate ? Math.min(Date.now(), new Date(expiryDate).getTime()) : Date.now()
  const days = Math.max(0, (endMs - new Date(investmentDate).getTime()) / 86400000)
  return amount * Math.pow(1 + rate / 100, days / 365) - amount
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

  const [plansRes, goalsRes, txRes, insuranceRes, insuranceSavingsRes, goldPriceRes] = await Promise.all([
    supabase.from('monthly_plans').select('id').eq('user_id', user.id),
    supabase
      .from('savings_goals')
      .select('goal_id, goal_name, target_amount')
      .eq('user_id', user.id),
    supabase
      .from('investment_transactions')
      .select('transaction_id, goal_id, amount_vnd, interest_rate, investment_date, asset_type, units, unit_price, fund_id, expiry_date, funds(id, name, nav, updated_at)')
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

  const planIds = (plansRes.data ?? []).map((p) => p.id)

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
  const allTxs = txRes.data ?? []
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

  // Aggregate fund transactions by goal+fund for P&L grouping
  type FundAccum = {
    fundId: string
    fundName: string
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

  const unallocatedNonFunds: {
    transactionId: string; type: string; amount: number; currentValue: number; interestRate: number | null; expiryDate: string | null; investmentDate: string
  }[] = []

  for (const tx of allTxs) {
    if (tx.asset_type === 'fund' && tx.units) {
      const fund = Array.isArray(tx.funds)
        ? tx.funds[0] as { id: string; name: string; nav: number; updated_at: string } | undefined
        : tx.funds as { id: string; name: string; nav: number; updated_at: string } | null
      if (!fund) continue

      if (isNavStale(fund.updated_at)) navStale = true

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
          totalUnits: tx.units,
          totalInvested: tx.amount_vnd,
          totalNavCost: tx.units * (tx.unit_price ?? 0),
          currentNAV: fund.nav,
          navUpdatedAt: fund.updated_at,
          goalId: tx.goal_id ?? null,
        })
      }
    } else {
      // bank / stock / gold
      let currentValue: number
      if (tx.asset_type === 'gold' && goldPricePerChi && tx.units) {
        currentValue = tx.units * goldPricePerChi
      } else {
        const interest = calcProjectedInterest(tx.amount_vnd, tx.interest_rate, tx.investment_date, (tx as { expiry_date?: string | null }).expiry_date)
        currentValue = tx.amount_vnd + interest
      }

      totalAssets += currentValue
      totalInvestedGlobal += tx.amount_vnd

      if (tx.goal_id && goalMap.has(tx.goal_id)) {
        const goalEntry = goalMap.get(tx.goal_id)!
        goalEntry.totalInvested += tx.amount_vnd
        goalEntry.currentValue += currentValue
      } else {
        unallocatedNonFundValue += currentValue
        const expiryDate = (tx as { expiry_date?: string | null }).expiry_date ?? null
        unallocatedNonFunds.push({
          transactionId: tx.transaction_id,
          type: tx.asset_type,
          amount: tx.amount_vnd,
          currentValue,
          interestRate: tx.interest_rate ?? null,
          expiryDate,
          investmentDate: tx.investment_date,
        })
      }
    }
  }

  // Convert fund accumulators to breakdown items
  const unallocatedFunds: Array<{
    fundId: string; fundName: string; quantity: number; currentNAV: number
    currentValue: number; purchasePrice: number; profitLoss: number; profitLossPercentage: number; goalId: null
  }> = []
  let unallocatedFundValue = 0

  for (const [, acc] of fundAccumMap) {
    const currentValue = acc.currentNAV * acc.totalUnits
    const profitLoss = currentValue - acc.totalInvested
    const profitLossPercentage = acc.totalInvested > 0 ? (profitLoss / acc.totalInvested) * 100 : 0
    const purchasePrice = acc.totalUnits > 0 ? acc.totalNavCost / acc.totalUnits : 0

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
      lastPaymentDate: m.last_payment_date ?? null,
    }
  })

  const totalLiabilities = 0
  const netWorth = totalAssets - totalLiabilities
  const overallProfitLoss = totalAssets - totalInvestedGlobal
  const overallProfitLossPercentage = totalInvestedGlobal > 0
    ? (overallProfitLoss / totalInvestedGlobal) * 100
    : 0

  const hasGold = allTxs.some((tx) => tx.asset_type === 'gold')

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
    },
    goals: goalsOutput,
    unallocated: {
      totalValue: unallocatedFundValue + unallocatedNonFundValue,
      funds: unallocatedFunds,
      nonFunds: unallocatedNonFunds,
    },
    insurance: insuranceOutput,
  })
}
