'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { GoalData } from '@/app/assets/DashboardClient'

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

interface Transaction {
  transaction_id: string
  investment_date: string
  asset_type: string
  amount_vnd: number
  units: number | null
  unit_price: number | null
  interest_rate: number | null
  notes: string | null
  fund_id: string | null
  fund_name?: string
}

const ASSET_COLORS: Record<string, string> = {
  fund: 'bg-purple-100 text-purple-700',
  bank: 'bg-blue-100 text-blue-700',
  stock: 'bg-green-100 text-green-700',
  gold: 'bg-amber-100 text-amber-700',
}

const ASSET_LABELS: Record<string, string> = {
  fund: 'Quỹ',
  bank: 'Ngân hàng',
  stock: 'Cổ phiếu',
  gold: 'Vàng',
}

export default function GoalDetailClient({ goalId }: { goalId: string }) {
  const router = useRouter()
  const [goal, setGoal] = useState<GoalData | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [overviewRes, txRes, fundsRes] = await Promise.all([
        fetch('/api/v1/dashboard/overview'),
        fetch(`/api/v1/investment-transactions?goal_id=${goalId}&limit=1000`),
        fetch('/api/funds'),
      ])

      if (!overviewRes.ok || !txRes.ok) {
        setError('Failed to load goal data.')
        setLoading(false)
        return
      }

      const overview = await overviewRes.json()
      const matchedGoal = (overview.goals as GoalData[]).find((g) => g.goalId === goalId) ?? null
      setGoal(matchedGoal)

      const { transactions: txs } = await txRes.json()
      const { funds: allFunds } = fundsRes.ok ? await fundsRes.json() : { funds: [] }
      const fundMap: Record<string, string> = {}
      for (const f of (allFunds ?? [])) fundMap[f.id] = f.name

      setTransactions(
        (txs ?? []).map((tx: Transaction) => ({
          ...tx,
          fund_name: tx.fund_id ? fundMap[tx.fund_id] : undefined,
        }))
      )
    } catch {
      setError('Unable to load data. Please check your connection.')
    }
    setLoading(false)
  }, [goalId])

  useEffect(() => { fetchData() }, [fetchData])

  const plPositive = (goal?.profitLoss ?? 0) >= 0
  const exceededTarget = goal?.progressPercentage !== null && (goal?.progressPercentage ?? 0) >= 100

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Back */}
        <button
          onClick={() => router.push('/dashboard')}
          className="flex items-center gap-1.5 text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium mb-6"
        >
          ← Back to Dashboard
        </button>

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-400 flex items-center justify-between">
            {error}
            <button onClick={fetchData} className="text-red-600 dark:text-red-400 font-medium hover:underline ml-4">Retry</button>
          </div>
        )}

        {loading && (
          <div className="space-y-4">
            <div className="h-8 w-48 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse" />
            <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse" />
            <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse" />
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Goal header */}
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">
                {goal?.goalName ?? 'Goal'}
              </h1>
              {!goal && (
                <p className="text-sm text-gray-400 dark:text-gray-500">Goal not found or has no data yet.</p>
              )}
            </div>

            {/* Summary cards */}
            {goal && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
                  <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-1">Current Value</p>
                  <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{fmt(goal.currentValue)}</p>
                </div>
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
                  <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-1">Invested</p>
                  <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{fmt(goal.totalInvested)}</p>
                </div>
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
                  <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-1">P&amp;L</p>
                  <p className={`text-lg font-bold ${plPositive ? 'text-green-600' : 'text-red-600'}`}>
                    {fmt(goal.profitLoss)}
                  </p>
                  <p className={`text-xs font-medium ${plPositive ? 'text-green-500' : 'text-red-500'}`}>
                    {fmtPct(goal.profitLossPercentage)}
                  </p>
                </div>
                {goal.targetAmount != null && (
                  <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
                    <p className="text-xs text-gray-400 dark:text-gray-500 font-medium uppercase tracking-wide mb-1">Progress</p>
                    <p className={`text-lg font-bold ${exceededTarget ? 'text-green-600' : 'text-gray-900 dark:text-gray-100'}`}>
                      {exceededTarget ? '🎉 Done' : `${Math.round(goal.progressPercentage ?? 0)}%`}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">of {fmt(goal.targetAmount)}</p>
                  </div>
                )}
              </div>
            )}

            {/* Progress bar */}
            {goal?.targetAmount != null && (
              <div className="mb-8 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
                <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400 mb-2">
                  <span>Target: {fmt(goal.targetAmount)}</span>
                  <span className={exceededTarget ? 'text-green-600 font-medium' : ''}>
                    {exceededTarget ? 'Target exceeded!' : `${Math.round(goal.progressPercentage ?? 0)}% complete`}
                  </span>
                </div>
                <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${exceededTarget ? 'bg-green-500' : 'bg-indigo-500'}`}
                    style={{ width: `${Math.min(goal.progressPercentage ?? 0, 100)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Transactions table */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">Transactions</h2>
              </div>

              {transactions.length === 0 ? (
                <div className="text-center py-12 text-gray-400 dark:text-gray-500 text-sm">No transactions yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-800">
                      <tr>
                        {['Date', 'Type', 'Fund', 'Amount', 'Units', 'Unit Price', 'Interest Rate', 'Notes'].map((h) => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                      {transactions.map((tx) => (
                        <tr key={tx.transaction_id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                          <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                            {new Date(tx.investment_date).toLocaleDateString('vi-VN')}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ASSET_COLORS[tx.asset_type] ?? 'bg-gray-100 text-gray-700'}`}>
                              {ASSET_LABELS[tx.asset_type] ?? tx.asset_type}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{tx.fund_name ?? '—'}</td>
                          <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">{fmt(tx.amount_vnd)}</td>
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{tx.units ?? '—'}</td>
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                            {tx.unit_price != null ? fmt(tx.unit_price) : '—'}
                          </td>
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                            {tx.interest_rate != null ? `${tx.interest_rate}%` : '—'}
                          </td>
                          <td className="px-4 py-3 text-gray-400 dark:text-gray-500 max-w-32 truncate">{tx.notes ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
