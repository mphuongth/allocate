'use client'

import { useState, useEffect, useCallback } from 'react'

interface Transaction {
  transaction_id: string
  goal_id: string | null
  asset_type: string
  investment_date: string
  amount_vnd: number
  unit_price: number | null
  units: number | null
  interest_rate: number | null
  notes: string | null
  savings_goals?: { goal_name: string } | null
}

const ASSET_TYPES = ['fund', 'bank', 'stock', 'gold'] as const
type AssetType = typeof ASSET_TYPES[number]

const ASSET_COLORS: Record<AssetType, string> = {
  fund: 'bg-purple-100 text-purple-700',
  bank: 'bg-blue-100 text-blue-700',
  stock: 'bg-green-100 text-green-700',
  gold: 'bg-amber-100 text-amber-700',
}

function calcProjectedInterest(amount: number, rate: number | null, investmentDate: string): number {
  if (!rate) return 0
  const months = Math.max(0, Math.floor(
    (Date.now() - new Date(investmentDate).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
  ))
  return amount * Math.pow(1 + rate / 100 / 12, months) - amount
}

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')

export default function InvestmentTransactionsTab() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [filterAsset, setFilterAsset] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page) })
    if (filterAsset) params.set('asset_type', filterAsset)
    if (filterFrom) params.set('from_date', filterFrom)
    if (filterTo) params.set('to_date', filterTo)
    const res = await fetch(`/api/v1/investment-transactions?${params}`)
    const data = await res.json()
    setTransactions(data.transactions ?? [])
    setTotal(data.total ?? 0)
    setLoading(false)
  }, [page, filterAsset, filterFrom, filterTo])

  useEffect(() => { fetchTransactions() }, [fetchTransactions])

  function applyFilters() { setPage(1); fetchTransactions() }
  function resetFilters() { setFilterAsset(''); setFilterFrom(''); setFilterTo(''); setPage(1) }

  const totalPages = Math.max(1, Math.ceil(total / 20))

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Investment Transactions</h2>
        <span className="text-sm text-gray-500 dark:text-gray-400">{total} total</span>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Asset Type</label>
          <select
            value={filterAsset}
            onChange={(e) => setFilterAsset(e.target.value)}
            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All</option>
            {ASSET_TYPES.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">From Date</label>
          <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)}
            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">To Date</label>
          <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)}
            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div className="flex gap-2">
          <button onClick={applyFilters} className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Apply</button>
          <button onClick={resetFilters} className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Reset</button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {loading ? (
          <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">Loading...</div>
        ) : transactions.length === 0 ? (
          <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">No transactions found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  {['Date', 'Asset', 'Amount', 'Units', 'Rate', 'Projected Interest', 'Goal', 'Notes'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                {transactions.map((tx) => {
                  const interest = calcProjectedInterest(tx.amount_vnd, tx.interest_rate, tx.investment_date)
                  return (
                    <tr key={tx.transaction_id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{new Date(tx.investment_date).toLocaleDateString('vi-VN')}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ASSET_COLORS[tx.asset_type as AssetType] ?? 'bg-gray-100 text-gray-700'}`}>
                          {tx.asset_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{fmt(tx.amount_vnd)}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{tx.units ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{tx.interest_rate != null ? `${tx.interest_rate}%` : '—'}</td>
                      <td className="px-4 py-3 text-indigo-600 dark:text-indigo-400 font-medium">{fmt(interest)}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{tx.savings_goals?.goal_name ?? <span className="text-gray-300 dark:text-gray-600">Unassigned</span>}</td>
                      <td className="px-4 py-3 text-gray-400 dark:text-gray-500 max-w-32 truncate">{tx.notes ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-gray-700">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
            >
              Previous
            </button>
            <span className="text-sm text-gray-500 dark:text-gray-400">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
