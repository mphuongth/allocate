'use client'

import { useState, useEffect, useCallback } from 'react'
import type { MonthlyPlan, DirectSaving } from '../PlanningClient'

interface Goal { goal_id: string; goal_name: string }

interface Props {
  plan: MonthlyPlan
  savings: DirectSaving[]
  onRefresh: () => void
  onToast: (msg: string) => void
}

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')
const emptyForm = { goal_id: '', amount_vnd: '', interest_rate: '', expiry_date: '', investment_date: '' }

const inputCls = 'w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500'

export default function DirectSavingsSection({ plan, savings, onRefresh, onToast }: Props) {
  const [goals, setGoals] = useState<Goal[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<DirectSaving | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<DirectSaving | null>(null)

  const minDate = new Date(plan.year, plan.month - 1, 1).toISOString().split('T')[0]
  const maxDate = new Date(plan.year, plan.month, 0).toISOString().split('T')[0]

  const fetchGoals = useCallback(async () => {
    const res = await fetch('/api/v1/savings-goals')
    const { goals } = res.ok ? await res.json() : { goals: [] }
    setGoals(goals ?? [])
  }, [])

  useEffect(() => { fetchGoals() }, [fetchGoals])

  function openAdd() {
    setEditItem(null)
    setForm({ ...emptyForm, investment_date: minDate })
    setFormError('')
    setShowForm(true)
  }

  function openEdit(item: DirectSaving) {
    setEditItem(item)
    setForm({
      goal_id: item.goal_id ?? '',
      amount_vnd: String(item.amount_vnd),
      interest_rate: item.interest_rate != null ? String(item.interest_rate) : '',
      expiry_date: item.expiry_date ?? '',
      investment_date: item.investment_date ?? minDate,
    })
    setFormError('')
    setShowForm(true)
  }

  async function handleSave() {
    setFormError('')
    const amountNum = Number(form.amount_vnd)
    if (!form.amount_vnd || isNaN(amountNum) || amountNum <= 0) {
      setFormError('Amount is required and must be positive')
      return
    }
    if (!form.investment_date) {
      setFormError('Investment date is required')
      return
    }

    setSaving(true)
    const payload = {
      asset_type: 'bank',
      plan_id: plan.id,
      goal_id: form.goal_id || null,
      amount_vnd: amountNum,
      interest_rate: form.interest_rate !== '' ? Number(form.interest_rate) : null,
      expiry_date: form.expiry_date || null,
      investment_date: form.investment_date,
    }

    const url = editItem
      ? `/api/v1/investment-transactions/${editItem.transaction_id}`
      : '/api/v1/investment-transactions'
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
        onToast(editItem ? 'Direct saving updated' : 'Direct saving added')
        onRefresh()
      }
    } catch {
      setFormError('Unable to save. Please check your connection and try again.')
    }
    setSaving(false)
  }

  async function handleDelete(item: DirectSaving) {
    const res = await fetch(`/api/v1/investment-transactions/${item.transaction_id}`, { method: 'DELETE' })
    if (res.ok) {
      setConfirmDelete(null)
      onToast('Direct saving deleted')
      onRefresh()
    }
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Direct Savings</h2>
        <button onClick={openAdd} className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
          Add Direct Saving
        </button>
      </div>

      {savings.length === 0 ? (
        <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">Add direct savings to allocate additional funds</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              {['Date', 'Amount', 'Interest %', 'Expiry Date', 'Goal', 'Actions'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {savings.map((item) => (
              <tr key={item.transaction_id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{item.investment_date ? new Date(item.investment_date).toLocaleDateString('vi-VN') : '—'}</td>
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{fmt(item.amount_vnd)}</td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{item.interest_rate != null ? `${item.interest_rate}%` : '—'}</td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{item.expiry_date ? new Date(item.expiry_date).toLocaleDateString('vi-VN') : '—'}</td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{item.savings_goals?.goal_name ?? 'Unassigned'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-3">
                    <button onClick={() => openEdit(item)} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Edit</button>
                    <button onClick={() => setConfirmDelete(item)} className="text-xs text-red-500 dark:text-red-400 hover:underline">Delete</button>
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
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm p-6 border border-gray-100 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{editItem ? 'Edit Direct Saving' : 'Add Direct Saving'}</h3>
            {formError && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{formError}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Investment Date *</label>
                <input type="date" value={form.investment_date} min={minDate} max={maxDate}
                  onChange={(e) => setForm({ ...form, investment_date: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Goal (optional)</label>
                <select value={form.goal_id} onChange={(e) => setForm({ ...form, goal_id: e.target.value })}
                  disabled={goals.length === 0} className={`${inputCls} disabled:opacity-50`}>
                  <option value="">{goals.length === 0 ? 'No goals available' : 'Unassigned'}</option>
                  {goals.map((g) => <option key={g.goal_id} value={g.goal_id}>{g.goal_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount (VND) *</label>
                <input type="number" value={form.amount_vnd} onChange={(e) => setForm({ ...form, amount_vnd: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Interest % (optional)</label>
                <input type="number" step="0.01" value={form.interest_rate} onChange={(e) => setForm({ ...form, interest_rate: e.target.value })}
                  placeholder="e.g. 5.5" className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Expiry Date (optional)</label>
                <input type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} className={inputCls} />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
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
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm p-6 border border-gray-100 dark:border-gray-700">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">Delete Saving</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-5">Are you sure you want to delete this saving?</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
              <button onClick={() => handleDelete(confirmDelete)} className="flex-1 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700">Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
