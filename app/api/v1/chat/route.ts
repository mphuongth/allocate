import { streamText } from 'ai'
import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { CHAT_PROVIDERS, DEFAULT_PROVIDER } from '@/lib/chat-providers'

export const maxDuration = 30

const ALLOWED_MODELS = new Set(CHAT_PROVIDERS.map((p) => p.model))
const DEFAULT_MODEL = CHAT_PROVIDERS.find((p) => p.id === DEFAULT_PROVIDER)!.model

function fmt(n: number) {
  return '₫ ' + Math.round(n).toLocaleString('vi-VN')
}

function calcProjectedInterest(amount: number, rate: number | null, investmentDate: string, expiryDate?: string | null): number {
  if (!rate) return 0
  const endMs = expiryDate ? Math.min(Date.now(), new Date(expiryDate).getTime()) : Date.now()
  const days = Math.max(0, (endMs - new Date(investmentDate).getTime()) / 86400000)
  return amount * Math.pow(1 + rate / 100, days / 365) - amount
}

function buildContext(
  goals: Array<{ goal_id: string; goal_name: string; target_amount: number | null }> | null,
  txs: Array<{
    transaction_id: string; goal_id: string | null; asset_type: string | null
    transaction_type: string | null; amount_vnd: number; units: number | null
    unit_price: number | null; interest_rate: number | null; expiry_date: string | null
    investment_date: string; units_withdrawn: number | null; principal_withdrawn: number | null
    fund_id: string | null; notes: string | null
    funds: { id: string; name: string; nav: number } | { id: string; name: string; nav: number }[] | null
  }> | null,
  goldPricePerChi: number | null
): string {
  if (!txs || !goals) return 'No financial data available.'

  const investments = txs.filter((tx) => tx.transaction_type !== 'withdrawal' && !(tx.asset_type === 'fund' && tx.units == null))
  const withdrawals = txs.filter((tx) => tx.transaction_type === 'withdrawal')

  // Build withdrawal maps
  const parentWdMap = new Map<string, { principal: number; units: number }>()
  const fundWdMap = new Map<string, { units: number; cost: number }>()
  for (const wd of withdrawals) {
    if (wd.asset_type === 'fund' && wd.fund_id) {
      const key = `${wd.goal_id ?? 'unallocated'}::${wd.fund_id}`
      const e = fundWdMap.get(key) ?? { units: 0, cost: 0 }
      e.units += wd.units_withdrawn ?? 0
      e.cost += wd.principal_withdrawn ?? 0
      fundWdMap.set(key, e)
    } else if (wd.transaction_id) {
      const parentId = (wd as { parent_transaction_id?: string }).parent_transaction_id
      if (parentId) {
        const e = parentWdMap.get(parentId) ?? { principal: 0, units: 0 }
        e.principal += wd.principal_withdrawn ?? 0
        e.units += wd.units_withdrawn ?? 0
        parentWdMap.set(parentId, e)
      }
    }
  }

  // Aggregate funds by goal+fund_id
  type FundAccum = { name: string; totalUnits: number; totalInvested: number; totalNavCost: number; nav: number; goalId: string | null }
  const fundMap = new Map<string, FundAccum>()

  let totalAssets = 0
  let totalInvested = 0

  // Non-fund assets
  const goalNonFund = new Map<string, number>()
  const goalNonFundInvested = new Map<string, number>()
  const unallocatedNonFunds: string[] = []

  for (const tx of investments) {
    if (tx.asset_type === 'fund' && tx.units) {
      const fund = Array.isArray(tx.funds) ? tx.funds[0] : tx.funds
      if (!fund) continue
      const key = `${tx.goal_id ?? 'unallocated'}::${fund.id}`
      const e = fundMap.get(key)
      if (e) {
        e.totalUnits += tx.units
        e.totalInvested += tx.amount_vnd
        e.totalNavCost += tx.units * (tx.unit_price ?? 0)
      } else {
        fundMap.set(key, { name: fund.name, totalUnits: tx.units, totalInvested: tx.amount_vnd, totalNavCost: tx.units * (tx.unit_price ?? 0), nav: fund.nav, goalId: tx.goal_id ?? null })
      }
    } else {
      const wd = parentWdMap.get(tx.transaction_id)
      const withdrawnPrincipal = wd?.principal ?? 0
      const withdrawnUnits = wd?.units ?? 0

      let currentValue: number
      let effectiveAmount: number
      let effectiveUnits = tx.units ?? null

      if (tx.asset_type === 'gold' && goldPricePerChi && tx.units) {
        effectiveUnits = tx.units - withdrawnUnits
        if (effectiveUnits <= 0) continue
        currentValue = effectiveUnits * goldPricePerChi
        effectiveAmount = tx.amount_vnd - withdrawnPrincipal
      } else {
        effectiveAmount = tx.amount_vnd - withdrawnPrincipal
        if (effectiveAmount <= 0) continue
        const interest = calcProjectedInterest(effectiveAmount, tx.interest_rate, tx.investment_date, tx.expiry_date)
        currentValue = effectiveAmount + interest
      }

      totalAssets += currentValue
      totalInvested += effectiveAmount

      if (tx.goal_id) {
        goalNonFund.set(tx.goal_id, (goalNonFund.get(tx.goal_id) ?? 0) + currentValue)
        goalNonFundInvested.set(tx.goal_id, (goalNonFundInvested.get(tx.goal_id) ?? 0) + effectiveAmount)
      } else {
        if (tx.asset_type === 'gold') {
          unallocatedNonFunds.push(`  - Gold: ${effectiveUnits?.toFixed(2)} chi @ ${fmt(goldPricePerChi!)} = ${fmt(currentValue)}`)
        } else if (tx.asset_type === 'bank') {
          const label = tx.notes ? `"${tx.notes}"` : new Date(tx.investment_date).toLocaleDateString('vi-VN')
          const rateStr = tx.interest_rate ? ` ${tx.interest_rate}%/yr` : ''
          const expiryStr = tx.expiry_date ? ` expires ${tx.expiry_date}` : ''
          unallocatedNonFunds.push(`  - Bank deposit ${label}${rateStr}${expiryStr}: ${fmt(effectiveAmount)} principal, current value ${fmt(currentValue)}`)
        } else {
          unallocatedNonFunds.push(`  - ${tx.asset_type}: ${fmt(currentValue)}`)
        }
      }
    }
  }

  // Apply fund withdrawals
  for (const [key, wd] of fundWdMap) {
    const acc = fundMap.get(key)
    if (!acc || wd.units <= 0) continue
    const before = acc.totalUnits
    acc.totalNavCost -= before > 0 ? (wd.units / before) * acc.totalNavCost : 0
    acc.totalUnits -= wd.units
    acc.totalInvested -= wd.cost
  }

  // Build goal summaries
  const goalMap = new Map(goals.map((g) => [g.goal_id, { name: g.goal_name, target: g.target_amount, fundValue: 0, fundInvested: 0, fundLines: [] as string[] }]))

  for (const [key, acc] of fundMap) {
    if (acc.totalUnits <= 0) continue
    const currentValue = acc.nav * acc.totalUnits
    totalAssets += currentValue
    totalInvested += acc.totalInvested

    if (acc.goalId && goalMap.has(acc.goalId)) {
      const g = goalMap.get(acc.goalId)!
      g.fundValue += currentValue
      g.fundInvested += acc.totalInvested
      g.fundLines.push(`    - ${acc.name}: ${acc.totalUnits.toFixed(2)} CCQ @ NAV ${fmt(acc.nav)} = ${fmt(currentValue)}`)
    } else {
      unallocatedNonFunds.unshift(`  - Fund ${acc.name}: ${acc.totalUnits.toFixed(2)} CCQ @ NAV ${fmt(acc.nav)} = ${fmt(currentValue)}`)
    }
  }

  const pl = totalAssets - totalInvested
  const plPct = totalInvested > 0 ? (pl / totalInvested) * 100 : 0

  const lines: string[] = [
    'NET WORTH',
    `  Total Assets: ${fmt(totalAssets)}`,
    `  Total Invested: ${fmt(totalInvested)}`,
    `  Overall P&L: ${pl >= 0 ? '+' : ''}${fmt(pl)} (${plPct >= 0 ? '+' : ''}${plPct.toFixed(2)}%)`,
    '',
    'SAVINGS GOALS',
  ]

  for (const [goalId, g] of goalMap) {
    const totalValue = g.fundValue + (goalNonFund.get(goalId) ?? 0)
    const targetStr = g.target ? ` / Target: ${fmt(g.target)} (${Math.round(totalValue / g.target * 100)}%)` : ''
    lines.push(`  [${g.name}] Current: ${fmt(totalValue)}${targetStr}`)
    for (const fl of g.fundLines) lines.push(fl)
  }

  lines.push('', 'UNALLOCATED ASSETS')
  if (unallocatedNonFunds.length > 0) {
    lines.push(...unallocatedNonFunds)
  } else {
    lines.push('  (none)')
  }

  return lines.join('\n')
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const body = await req.json()
  const { messages, model: requestedModel } = body

  const model = ALLOWED_MODELS.has(requestedModel) ? requestedModel : DEFAULT_MODEL

  const [goalsRes, txRes, goldRes] = await Promise.all([
    supabase.from('savings_goals').select('goal_id, goal_name, target_amount').eq('user_id', user.id),
    supabase
      .from('investment_transactions')
      .select('transaction_id, goal_id, asset_type, transaction_type, amount_vnd, units, unit_price, interest_rate, expiry_date, investment_date, units_withdrawn, principal_withdrawn, fund_id, parent_transaction_id, notes, funds(id, name, nav)')
      .eq('user_id', user.id),
    supabase.from('gold_price_settings').select('price_per_chi').eq('user_id', user.id).single(),
  ])

  const financialContext = buildContext(goalsRes.data, txRes.data as never, goldRes.data?.price_per_chi ?? null)

  const result = streamText({
    model,
    system: `You are a personal finance assistant for this user's investment portfolio app (Allocate).
Today: ${new Date().toLocaleDateString('vi-VN')}

Here is the user's current portfolio data:
${financialContext}

Rules:
- Respond in the same language the user writes in (Vietnamese or English)
- Format Vietnamese dong as ₫ X,XXX,XXX
- Be concise and helpful; do not make up data not provided above
- CCQ = Chứng chỉ Quỹ = fund certificate units`,
    messages,
    maxOutputTokens: 1024,
    providerOptions: { gateway: { tags: ['feature:chat'] } },
  })

  return result.toUIMessageStreamResponse()
}
