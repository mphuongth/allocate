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
const emptyForm = { goal_id: '', amount_vnd: '', profit_percent: '', expiry_date: '' }

export default function DirectSavingsSection({ plan, savings, onRefresh, onToast }: Props) {
  const [goals, setGoals] = useState<Goal[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<DirectSaving | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<DirectSaving | null>(null)

  const fetchGoals = useCallback(async () => {
    const res = await fetch('/api/v1/savings-goals')
    const { goals } = res.ok ? await res.json() : { goals: [] }
    setGoals(goals ?? [])
  }, [])

  useEffect(() => { fetchGoals() }, [fetchGoals])

  function openAdd() {
    setEditItem(null)
    setForm(emptyForm)
    setFormError('')
    setShowForm(true)
  }

  function openEdit(item: DirectSaving) {
    setEditItem(item)
    setForm({
      goal_id: item.goal_id ?? '',
      amount_vnd: String(item.amount_vnd),
      profit_percent: item.profit_percent != null ? String(item.profit_percent) : '',
      expiry_date: item.expiry_date ?? '',
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

    setSaving(true)
    const payload = {
      plan_id: plan.id,
      goal_id: form.goal_id || null,
      amount_vnd: amountNum,
      profit_percent: form.profit_percent !== '' ? Number(form.profit_percent) : null,
      expiry_date: form.expiry_date || null,
    }

    const url = editItem ? `/api/v1/direct-savings/${editItem.id}` : '/api/v1/direct-savings'
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
    const res = await fetch(`/api/v1/direct-savings/${item.id}`, { method: 'DELETE' })
    if (res.ok) {
      setConfirmDelete(null)
      onToast('Direct saving deleted')
      onRefresh()
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <h2 className="font-semibold text-gray-900">Direct Savings</h2>
        <button onClick={openAdd} className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
          Add Direct Saving
        </button>
      </div>

      {savings.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">Add direct savings to allocate additional funds</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['Amount', 'Profit %', 'Expiry Date', 'Goal', 'Actions'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {savings.map((item) => (
              <tr key={item.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{fmt(item.amount_vnd)}</td>
                <td className="px-4 py-3 text-gray-500">{item.profit_percent != null ? `${item.profit_percent}%` : '—'}</td>
                <td className="px-4 py-3 text-gray-500">{item.expiry_date ? new Date(item.expiry_date).toLocaleDateString('vi-VN') : '—'}</td>
                <td className="px-4 py-3 text-gray-500">{item.savings_goals?.goal_name ?? 'Unassigned'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-3">
                    <button onClick={() => openEdit(item)} className="text-xs text-indigo-600 hover:underline">Edit</button>
                    <button onClick={() => setConfirmDelete(item)} className="text-xs text-red-500 hover:underline">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Add/Edit Modal — fields in spec order: Goal, Amount, Profit%, Expiry */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{editItem ? 'Edit Direct Saving' : 'Add Direct Saving'}</h3>
            {formError && <p className="text-red-600 text-sm mb-3">{formError}</p>}
            <div className="space-y-3">
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
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Profit % (optional)</label>
                <input type="number" step="0.01" value={form.profit_percent} onChange={(e) => setForm({ ...form, profit_percent: e.target.value })}
                  placeholder="e.g. 5.5" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Expiry Date (optional)</label>
                <input type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
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
            <h3 className="text-base font-semibold text-gray-900 mb-2">Delete Saving</h3>
            <p className="text-sm text-gray-600 mb-5">Are you sure you want to delete this saving?</p>
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
