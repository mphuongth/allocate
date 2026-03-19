'use client'

import { useState, useEffect, useCallback } from 'react'

interface Transaction {
  transaction_id: string
  asset_type: string
  investment_date: string
  amount_vnd: number
  interest_rate: number | null
  notes: string | null
}

interface Goal {
  goal_id: string
  goal_name: string
}

const ASSET_COLORS: Record<string, string> = {
  fund: 'bg-purple-100 text-purple-700',
  bank: 'bg-blue-100 text-blue-700',
  stock: 'bg-green-100 text-green-700',
  gold: 'bg-amber-100 text-amber-700',
}

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')

export default function UnassignedInvestmentsTab() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showAssign, setShowAssign] = useState(false)
  const [assignGoalId, setAssignGoalId] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [txRes, goalsRes] = await Promise.all([
      fetch('/api/v1/investment-transactions?unassigned=true&limit=1000'),
      fetch('/api/v1/savings-goals'),
    ])
    const { transactions } = await txRes.json()
    const { goals } = await goalsRes.json()
    setTransactions(transactions ?? [])
    setGoals(goals ?? [])
    setSelected(new Set())
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === transactions.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(transactions.map((tx) => tx.transaction_id)))
    }
  }

  async function handleAssign() {
    if (!assignGoalId) return
    setAssigning(true)
    await Promise.all(
      Array.from(selected).map((id) =>
        fetch(`/api/v1/investment-transactions/${id}/assign`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goal_id: assignGoalId }),
        })
      )
    )
    setShowAssign(false)
    setAssignGoalId('')
    setSuccessMsg(`${selected.size} transaction(s) assigned.`)
    setTimeout(() => setSuccessMsg(''), 4000)
    setAssigning(false)
    await fetchAll()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this transaction permanently?')) return
    await fetch(`/api/v1/investment-transactions/${id}`, { method: 'DELETE' })
    setSuccessMsg('Transaction deleted.')
    setTimeout(() => setSuccessMsg(''), 4000)
    await fetchAll()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Unassigned Investments</h2>
        {selected.size > 0 && (
          <button
            onClick={() => { setAssignGoalId(''); setShowAssign(true) }}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
          >
            Assign to Goal ({selected.size})
          </button>
        )}
      </div>

      {successMsg && (
        <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-300 rounded-lg text-sm">{successMsg}</div>
      )}

      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {loading ? (
          <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">Loading...</div>
        ) : transactions.length === 0 ? (
          <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">No unassigned investments.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={selected.size === transactions.length}
                      onChange={toggleAll}
                      className="rounded"
                    />
                  </th>
                  {['Date', 'Asset', 'Amount', 'Rate', 'Notes', 'Actions'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                {transactions.map((tx) => (
                  <tr key={tx.transaction_id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(tx.transaction_id)}
                        onChange={() => toggleSelect(tx.transaction_id)}
                        className="rounded"
                      />
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{new Date(tx.investment_date).toLocaleDateString('vi-VN')}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ASSET_COLORS[tx.asset_type] ?? 'bg-gray-100 text-gray-700'}`}>
                        {tx.asset_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{fmt(tx.amount_vnd)}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{tx.interest_rate != null ? `${tx.interest_rate}%` : '—'}</td>
                    <td className="px-4 py-3 text-gray-400 dark:text-gray-500 max-w-32 truncate">{tx.notes ?? '—'}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleDelete(tx.transaction_id)}
                        className="text-xs text-red-500 dark:text-red-400 hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Assign modal */}
      {showAssign && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm p-6 border border-gray-100 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Assign to Goal</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Assigning {selected.size} transaction(s).</p>
            <select
              value={assignGoalId}
              onChange={(e) => setAssignGoalId(e.target.value)}
              className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm mb-4 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Select a goal...</option>
              {goals.map((g) => <option key={g.goal_id} value={g.goal_id}>{g.goal_name}</option>)}
            </select>
            <div className="flex gap-3">
              <button onClick={() => setShowAssign(false)} className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
              <button onClick={handleAssign} disabled={!assignGoalId || assigning} className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {assigning ? 'Assigning...' : 'Assign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
