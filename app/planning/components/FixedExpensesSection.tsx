'use client'

import { useState } from 'react'
import type { MonthlyPlan, FixedExpense } from '../PlanningClient'

interface Props {
  plan: MonthlyPlan
  fixedExpenses: FixedExpense[]
  onRefresh: () => void
  onToast: (msg: string) => void
}

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')

export default function FixedExpensesSection({ plan, fixedExpenses, onRefresh, onToast }: Props) {
  const [editItem, setEditItem] = useState<FixedExpense | null>(null)
  const [overrideValue, setOverrideValue] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<FixedExpense | null>(null)

  function openEdit(expense: FixedExpense) {
    setEditItem(expense)
    const monthly = expense.override != null ? expense.override : expense.amount_vnd
    setOverrideValue(String(monthly))
    setFormError('')
  }

  async function handleSaveOverride() {
    if (!editItem) return
    setFormError('')
    const num = Number(overrideValue)
    if (!overrideValue || isNaN(num) || num <= 0) {
      setFormError('Override amount must be positive')
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/v1/monthly-plans/${plan.id}/fixed-expense-overrides`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fixed_expense_id: editItem.expense_id, monthly_amount_override_vnd: num }),
      })

      if (!res.ok) {
        const { error } = await res.json()
        setFormError(error ?? 'Something went wrong. Please try again later.')
      } else {
        setEditItem(null)
        onToast('Fixed expense override saved')
        onRefresh()
      }
    } catch {
      setFormError('Unable to save. Please check your connection and try again.')
    }
    setSaving(false)
  }

  async function handleRemoveOverride(expense: FixedExpense) {
    if (expense.override == null) {
      setConfirmRemove(null)
      return
    }
    // Find override ID — we need to fetch it
    const res = await fetch(`/api/v1/monthly-plans/${plan.id}/fixed-expense-overrides`)
    if (!res.ok) { setConfirmRemove(null); return }
    const overrides: Array<{ id: string; fixed_expense_id: string }> = await res.json()
    const match = overrides.find((o) => o.fixed_expense_id === expense.expense_id)
    if (!match) { setConfirmRemove(null); return }

    const delRes = await fetch(`/api/v1/monthly-plans/${plan.id}/fixed-expense-overrides/${match.id}`, { method: 'DELETE' })
    if (delRes.ok) {
      setConfirmRemove(null)
      onToast('Override removed')
      onRefresh()
    }
  }

  if (fixedExpenses.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Fixed Expenses</h2>
        </div>
        <div className="text-center py-10 text-gray-400 text-sm">No fixed expenses configured</div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="font-semibold text-gray-900">Fixed Expenses</h2>
        <p className="text-xs text-gray-400 mt-0.5">Monthly amounts as entered in Settings. Override for this month only.</p>
      </div>

      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            {['Expense', 'Default Monthly', 'This Month', 'Actions'].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {fixedExpenses.map((expense) => {
            const defaultMonthly = expense.amount_vnd
            const thisMonth = expense.override ?? defaultMonthly
            const hasOverride = expense.override != null
            return (
              <tr key={expense.expense_id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{expense.expense_name}</td>
                <td className="px-4 py-3 text-gray-500">{fmt(defaultMonthly)}</td>
                <td className="px-4 py-3">
                  <span className={hasOverride ? 'text-indigo-600 font-medium' : 'text-gray-500'}>
                    {fmt(thisMonth)}
                  </span>
                  {hasOverride && <span className="ml-1.5 text-xs text-indigo-400">(overridden)</span>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-3">
                    <button onClick={() => openEdit(expense)} className="text-xs text-indigo-600 hover:underline">Edit</button>
                    {hasOverride && (
                      <button onClick={() => setConfirmRemove(expense)} className="text-xs text-red-500 hover:underline">Reset</button>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Edit Override Modal */}
      {editItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Override Monthly Amount</h3>
            <p className="text-sm text-gray-500 mb-4">{editItem.expense_name}</p>
            {formError && <p className="text-red-600 text-sm mb-3">{formError}</p>}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">This Month Amount (VND) *</label>
              <input
                type="number"
                value={overrideValue}
                onChange={(e) => setOverrideValue(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-xs text-gray-400 mt-1">Default: {fmt(editItem.amount_vnd)}/month</p>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setEditItem(null)} className="flex-1 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleSaveOverride} disabled={saving} className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Confirmation */}
      {confirmRemove && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-2">Reset Override</h3>
            <p className="text-sm text-gray-600 mb-5">Reset <strong>{confirmRemove.expense_name}</strong> to the default monthly amount?</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmRemove(null)} className="flex-1 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={() => handleRemoveOverride(confirmRemove)} className="flex-1 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700">Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
