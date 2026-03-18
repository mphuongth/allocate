'use client'

import { useState, useEffect, useCallback } from 'react'
import type { MonthlyPlan, FundInvestment } from '../PlanningClient'

interface Fund { id: string; name: string; nav: number }
interface Goal { goal_id: string; goal_name: string }

interface Props {
  plan: MonthlyPlan
  investments: FundInvestment[]
  onRefresh: () => void
  onToast: (msg: string) => void
}

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')

const emptyForm = { fund_id: '', goal_id: '', amount_vnd: '', units_purchased: '', nav_at_purchase: '', investment_date: '' }

export default function FundInvestmentsSection({ plan, investments, onRefresh, onToast }: Props) {
  const [funds, setFunds] = useState<Fund[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<FundInvestment | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<FundInvestment | null>(null)

  const fetchRefs = useCallback(async () => {
    const [fundsRes, goalsRes] = await Promise.all([
      fetch('/api/funds'),
      fetch('/api/v1/savings-goals'),
    ])
    const { funds } = fundsRes.ok ? await fundsRes.json() : { funds: [] }
    const { goals } = goalsRes.ok ? await goalsRes.json() : { goals: [] }
    setFunds(funds ?? [])
    setGoals(goals ?? [])
  }, [])

  useEffect(() => { fetchRefs() }, [fetchRefs])

  const minDate = new Date(plan.year, plan.month - 1, 1).toISOString().split('T')[0]
  const maxDate = new Date(plan.year, plan.month, 0).toISOString().split('T')[0]

  function openAdd() {
    setEditItem(null)
    setForm({ ...emptyForm, investment_date: minDate })
    setFormError('')
    setShowForm(true)
  }

  function openEdit(inv: FundInvestment) {
    setEditItem(inv)
    setForm({
      fund_id: inv.fund_id,
      goal_id: inv.goal_id ?? '',
      amount_vnd: String(inv.amount_vnd),
      units_purchased: String(inv.units_purchased),
      nav_at_purchase: String(inv.nav_at_purchase),
      investment_date: inv.investment_date ?? minDate,
    })
    setFormError('')
    setShowForm(true)
  }

  function handleFundSelect(fundId: string) {
    const fund = funds.find((f) => f.id === fundId)
    setForm((prev) => ({
      ...prev,
      fund_id: fundId,
      nav_at_purchase: fund ? String(fund.nav) : prev.nav_at_purchase,
    }))
  }

  async function handleSave() {
    setFormError('')
    if (!form.fund_id) { setFormError('Fund is required'); return }
    if (!form.investment_date) { setFormError('Investment date is required'); return }
    if (!form.amount_vnd || Number(form.amount_vnd) <= 0) { setFormError('Amount and units are required and must be positive'); return }
    if (!form.units_purchased || Number(form.units_purchased) <= 0) { setFormError('Amount and units are required and must be positive'); return }
    if (!form.nav_at_purchase || Number(form.nav_at_purchase) <= 0) { setFormError('NAV at purchase must be positive'); return }

    setSaving(true)
    const payload = {
      plan_id: plan.id,
      fund_id: form.fund_id,
      goal_id: form.goal_id || null,
      amount_vnd: Number(form.amount_vnd),
      units_purchased: Number(form.units_purchased),
      nav_at_purchase: Number(form.nav_at_purchase),
      investment_date: form.investment_date,
    }

    const url = editItem ? `/api/v1/fund-investments/${editItem.id}` : '/api/v1/fund-investments'
    try {
      const res = await fetch(url, {
        method: editItem ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const { error } = await res.json()
        setFormError(error ?? 'Something went wrong. Please try again later.')
      } else {
        setShowForm(false)
        onToast(editItem ? 'Fund investment updated' : 'Fund investment added')
        onRefresh()
      }
    } catch {
      setFormError('Unable to save. Please check your connection and try again.')
    }
    setSaving(false)
  }

  async function handleDelete(inv: FundInvestment) {
    const res = await fetch(`/api/v1/fund-investments/${inv.id}`, { method: 'DELETE' })
    if (res.ok) {
      setConfirmDelete(null)
      onToast('Fund investment deleted')
      onRefresh()
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <h2 className="font-semibold text-gray-900">Fund Investments</h2>
        <button onClick={openAdd} className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
          Add Fund Investment
        </button>
      </div>

      {investments.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">Add your first fund investment to get started</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['Fund', 'Date', 'Amount', 'Units', 'Goal', 'Actions'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {investments.map((inv) => (
              <tr key={inv.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{inv.funds?.name ?? '—'}</td>
                <td className="px-4 py-3 text-gray-500">{inv.investment_date ?? '—'}</td>
                <td className="px-4 py-3">{fmt(inv.amount_vnd)}</td>
                <td className="px-4 py-3 text-gray-500">{inv.units_purchased}</td>
                <td className="px-4 py-3 text-gray-500">{inv.savings_goals?.goal_name ?? 'Unassigned'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-3">
                    <button onClick={() => openEdit(inv)} className="text-xs text-indigo-600 hover:underline">Edit</button>
                    <button onClick={() => setConfirmDelete(inv)} className="text-xs text-red-500 hover:underline">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Add/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{editItem ? 'Edit Fund Investment' : 'Add Fund Investment'}</h3>
            {formError && <p className="text-red-600 text-sm mb-3">{formError}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fund *</label>
                <select
                  value={form.fund_id}
                  onChange={(e) => handleFundSelect(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Select fund...</option>
                  {funds.map((f) => (
                    <option key={f.id} value={f.id}>{f.name} (NAV: {f.nav})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Investment Date *</label>
                <input
                  type="date"
                  value={form.investment_date}
                  min={minDate}
                  max={maxDate}
                  onChange={(e) => setForm((prev) => ({ ...prev, investment_date: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Goal (optional)</label>
                <select
                  value={form.goal_id}
                  onChange={(e) => setForm({ ...form, goal_id: e.target.value })}
                  disabled={goals.length === 0}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                >
                  <option value="">{goals.length === 0 ? 'No goals available' : 'Unassigned'}</option>
                  {goals.map((g) => <option key={g.goal_id} value={g.goal_id}>{g.goal_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (VND) *</label>
                <input type="number" value={form.amount_vnd} onChange={(e) => setForm({ ...form, amount_vnd: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Units Purchased *</label>
                  <input type="number" step="0.0001" value={form.units_purchased} onChange={(e) => setForm({ ...form, units_purchased: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">NAV at Purchase *</label>
                  <input type="number" step="0.0001" value={form.nav_at_purchase} onChange={(e) => setForm({ ...form, nav_at_purchase: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-2">Delete Investment</h3>
            <p className="text-sm text-gray-600 mb-5">Are you sure you want to delete this investment?</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={() => handleDelete(confirmDelete)} className="flex-1 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700">Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
