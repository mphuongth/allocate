'use client'

import { useState, useEffect, useCallback } from 'react'
import GoalDetailView from './GoalDetailView'

interface SavingsGoal {
  goal_id: string
  goal_name: string
  description: string | null
  created_at: string
}

interface GoalWithStats extends SavingsGoal {
  transactionCount: number
  totalInvested: number
  projectedInterest: number
}

interface Transaction {
  transaction_id: string
  goal_id: string | null
  amount_vnd: number
  interest_rate: number | null
  investment_date: string
}

interface FundInvestment {
  id: string
  goal_id: string | null
  amount_vnd: number
  units_purchased: number
  nav_at_purchase: number
  funds: { nav: number } | null
}

function calcProjectedInterest(amount: number, rate: number | null, investmentDate: string): number {
  if (!rate) return 0
  const months = Math.max(0, Math.floor(
    (Date.now() - new Date(investmentDate).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
  ))
  return amount * Math.pow(1 + rate / 100 / 12, months) - amount
}

export default function SavingsGoalsTab() {
  const [goals, setGoals] = useState<GoalWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedGoal, setSelectedGoal] = useState<SavingsGoal | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editGoal, setEditGoal] = useState<SavingsGoal | null>(null)
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')

  const fetchGoals = useCallback(async () => {
    setLoading(true)
    const [goalsRes, txRes, fiRes] = await Promise.all([
      fetch('/api/v1/savings-goals'),
      fetch('/api/v1/investment-transactions?limit=1000'),
      fetch('/api/v1/fund-investments'),
    ])
    const { goals: rawGoals } = await goalsRes.json()
    const { transactions } = await txRes.json()
    const fundInvestments: FundInvestment[] = fiRes.ok ? await fiRes.json() : []

    const statsMap = new Map<string, { count: number; invested: number; interest: number }>()

    // investment_transactions: bank/stock/gold + legacy fund entries
    ;(transactions as Transaction[]).forEach((tx) => {
      if (!tx.goal_id) return
      const interest = calcProjectedInterest(tx.amount_vnd, tx.interest_rate, tx.investment_date)
      const existing = statsMap.get(tx.goal_id) ?? { count: 0, invested: 0, interest: 0 }
      statsMap.set(tx.goal_id, {
        count: existing.count + 1,
        invested: existing.invested + tx.amount_vnd,
        interest: existing.interest + interest,
      })
    })

    // fund_investments: NAV-based P&L
    fundInvestments.forEach((fi) => {
      if (!fi.goal_id) return
      const currentNav = fi.funds?.nav ?? fi.nav_at_purchase
      const currentValue = fi.units_purchased * currentNav
      const gain = currentValue - fi.amount_vnd
      const existing = statsMap.get(fi.goal_id) ?? { count: 0, invested: 0, interest: 0 }
      statsMap.set(fi.goal_id, {
        count: existing.count + 1,
        invested: existing.invested + fi.amount_vnd,
        interest: existing.interest + gain,
      })
    })

    setGoals((rawGoals ?? []).map((g: SavingsGoal) => {
      const stats = statsMap.get(g.goal_id) ?? { count: 0, invested: 0, interest: 0 }
      return { ...g, transactionCount: stats.count, totalInvested: stats.invested, projectedInterest: stats.interest }
    }))
    setLoading(false)
  }, [])

  useEffect(() => { fetchGoals() }, [fetchGoals])

  function openCreate() {
    setEditGoal(null)
    setFormName('')
    setFormDesc('')
    setFormError('')
    setShowForm(true)
  }

  function openEdit(goal: SavingsGoal) {
    setEditGoal(goal)
    setFormName(goal.goal_name)
    setFormDesc(goal.description ?? '')
    setFormError('')
    setShowForm(true)
  }

  async function handleSave() {
    if (!formName.trim()) { setFormError('Goal name is required.'); return }
    setSaving(true)
    setFormError('')
    const url = editGoal ? `/api/v1/savings-goals/${editGoal.goal_id}` : '/api/v1/savings-goals'
    const method = editGoal ? 'PUT' : 'POST'
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal_name: formName, description: formDesc }),
    })
    if (!res.ok) {
      const { error } = await res.json()
      setFormError(error ?? 'Something went wrong.')
    } else {
      setShowForm(false)
      await fetchGoals()
    }
    setSaving(false)
  }

  async function handleDelete(goal: GoalWithStats) {
    if (!confirm(`Delete "${goal.goal_name}"? ${goal.transactionCount} transaction(s) will be unassigned.`)) return
    const res = await fetch(`/api/v1/savings-goals/${goal.goal_id}`, { method: 'DELETE' })
    if (res.ok) {
      const { message } = await res.json()
      setSuccessMsg(message)
      setTimeout(() => setSuccessMsg(''), 5000)
      await fetchGoals()
    }
  }

  const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')

  if (selectedGoal) {
    return (
      <GoalDetailView
        goal={selectedGoal}
        onBack={() => { setSelectedGoal(null); fetchGoals() }}
      />
    )
  }

  return (
    <div>
      {successMsg && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-800 rounded-lg text-sm">{successMsg}</div>
      )}

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Savings Goals</h2>
        <button onClick={openCreate} className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">
          Create Goal
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading...</div>
      ) : goals.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-lg mb-2">No savings goals yet</p>
          <p className="text-sm">Create a goal to start tracking your investments.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {goals.map((goal) => (
            <div key={goal.goal_id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 hover:shadow-md transition-shadow">
              <div className="mb-3">
                <h3 className="font-semibold text-gray-900 text-base">{goal.goal_name}</h3>
                {goal.description && <p className="text-sm text-gray-500 mt-1">{goal.description}</p>}
              </div>

              <div className="bg-indigo-50 rounded-lg p-3 mb-3">
                <p className="text-xs text-indigo-600 font-medium mb-1">Current Total Value</p>
                <p className="text-xl font-bold text-indigo-700">{fmt(goal.totalInvested + goal.projectedInterest)}</p>
                <div className="flex gap-4 mt-2 text-xs text-gray-500">
                  <span>Invested: {fmt(goal.totalInvested)}</span>
                  <span>Interest: {fmt(goal.projectedInterest)}</span>
                </div>
              </div>

              <p className="text-xs text-gray-400 mb-4">
                {new Date(goal.created_at).toLocaleDateString('vi-VN')} · {goal.transactionCount} transaction{goal.transactionCount !== 1 ? 's' : ''}
              </p>

              <div className="flex gap-2">
                <button
                  onClick={() => setSelectedGoal(goal)}
                  className="flex-1 py-2 text-sm font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors"
                >
                  View Details
                </button>
                <button
                  onClick={() => openEdit(goal)}
                  className="px-3 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(goal)}
                  className="px-3 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{editGoal ? 'Edit Goal' : 'Create Goal'}</h3>
            {formError && <p className="text-red-600 text-sm mb-3">{formError}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Goal Name *</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Retirement"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  rows={3}
                  placeholder="Optional description"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
