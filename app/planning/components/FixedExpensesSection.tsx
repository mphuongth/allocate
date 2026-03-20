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

const inputCls = 'w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500'

export default function FixedExpensesSection({ plan, fixedExpenses, onRefresh, onToast }: Props) {
  const [editItem, setEditItem] = useState<FixedExpense | null>(null)
  const [overrideValue, setOverrideValue] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmSkip, setConfirmSkip] = useState<FixedExpense | null>(null)

  function openEdit(expense: FixedExpense) {
    setEditItem(expense)
    // Pre-fill with default amount (not the skip override of 0)
    const monthly = (expense.override != null && expense.override > 0) ? expense.override : expense.amount_vnd
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

  async function handleSkip(expense: FixedExpense) {
    // Set override to 0 — skips this expense for this month only
    await fetch(`/api/v1/monthly-plans/${plan.id}/fixed-expense-overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixed_expense_id: expense.expense_id, monthly_amount_override_vnd: 0 }),
    })
    setConfirmSkip(null)
    onToast(`${expense.expense_name} skipped for this month`)
    onRefresh()
  }

  async function handleRestore(expense: FixedExpense) {
    // Remove the override entirely — restores to default amount
    const res = await fetch(`/api/v1/monthly-plans/${plan.id}/fixed-expense-overrides`)
    if (!res.ok) return
    const overrides: Array<{ id: string; fixed_expense_id: string }> = await res.json()
    const match = overrides.find((o) => o.fixed_expense_id === expense.expense_id)
    if (!match) return

    const delRes = await fetch(`/api/v1/monthly-plans/${plan.id}/fixed-expense-overrides/${match.id}`, { method: 'DELETE' })
    if (delRes.ok) {
      onToast(`${expense.expense_name} restored`)
      onRefresh()
    }
  }

  if (fixedExpenses.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Fixed Expenses</h2>
        </div>
        <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">No fixed expenses configured</div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Fixed Expenses</h2>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Monthly amounts as entered in Settings. Override or skip for this month only.</p>
      </div>

      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-800">
          <tr>
            {['Expense', 'Default Monthly', 'This Month', 'Actions'].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {fixedExpenses.map((expense) => {
            const isSkipped = expense.override === 0
            const hasOverride = expense.override != null && expense.override > 0
            const thisMonth = expense.override ?? expense.amount_vnd
            return (
              <tr key={expense.expense_id} className={`hover:bg-gray-50 dark:hover:bg-gray-800 ${isSkipped ? 'opacity-60' : ''}`}>
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{expense.expense_name}</td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{fmt(expense.amount_vnd)}</td>
                <td className="px-4 py-3">
                  {isSkipped ? (
                    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                      Skipped
                    </span>
                  ) : (
                    <>
                      <span className={hasOverride ? 'text-indigo-600 dark:text-indigo-400 font-medium' : 'text-gray-500 dark:text-gray-400'}>
                        {fmt(thisMonth)}
                      </span>
                      {hasOverride && <span className="ml-1.5 text-xs text-indigo-400 dark:text-indigo-500">(overridden)</span>}
                    </>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-3">
                    {isSkipped ? (
                      <button onClick={() => handleRestore(expense)} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Restore</button>
                    ) : (
                      <>
                        <button onClick={() => openEdit(expense)} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Edit</button>
                        <button onClick={() => setConfirmSkip(expense)} className="text-xs text-red-500 dark:text-red-400 hover:underline">Delete</button>
                      </>
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
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm p-6 border border-gray-100 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Override Monthly Amount</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{editItem.expense_name}</p>
            {formError && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{formError}</p>}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">This Month Amount (VND) *</label>
              <div className="flex gap-2">
                <input type="number" value={overrideValue} onChange={(e) => setOverrideValue(e.target.value)} className={inputCls} />
                <button
                  type="button"
                  onClick={() => setOverrideValue(String(editItem.amount_vnd))}
                  className="shrink-0 px-3 py-2 text-xs font-medium text-indigo-600 dark:text-indigo-400 border border-indigo-300 dark:border-indigo-700 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 whitespace-nowrap"
                >
                  Default
                </button>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Default: {fmt(editItem.amount_vnd)}/month</p>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setEditItem(null)} className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
              <button onClick={handleSaveOverride} disabled={saving} className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Skip Confirmation */}
      {confirmSkip && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm p-6 border border-gray-100 dark:border-gray-700">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">Skip this month?</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-5">
              <strong>{confirmSkip.expense_name}</strong> will be excluded from this month's plan only. Settings and other months are not affected.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmSkip(null)} className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
              <button onClick={() => handleSkip(confirmSkip)} className="flex-1 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700">Skip</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
