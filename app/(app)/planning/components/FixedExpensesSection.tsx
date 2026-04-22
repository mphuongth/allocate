'use client'

import { useState } from 'react'
import { Edit, AlertTriangle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import type { MonthlyPlan, FixedExpense } from '../PlanningClient'

interface Props {
  plan: MonthlyPlan
  fixedExpenses: FixedExpense[]
  onRefresh: () => void
  onToast: (msg: string) => void
}

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')


export default function FixedExpensesSection({ plan, fixedExpenses, onRefresh, onToast }: Props) {
  const t = useTranslations('planning')
  const tc = useTranslations('common')
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
      setFormError(t('overrideRequired'))
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
        setFormError(error ?? t('cannotSave'))
      } else {
        setEditItem(null)
        onToast(t('expenseSaved'))
        onRefresh()
      }
    } catch {
      setFormError(t('cannotSave'))
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
    onToast(t('expenseSkipped', { name: expense.expense_name }))
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
      onToast(t('expenseRestored', { name: expense.expense_name }))
      onRefresh()
    }
  }

  if (fixedExpenses.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="px-5 py-4">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">{t('fixedExpensesTitle')}</h2>
        </div>
        <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">{t('fixedExpensesDesc')}</div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="px-5 py-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('fixedExpensesTitle')}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('fixedExpensesDesc')}</p>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700">
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colExpense')}</th>
            <th className="hidden sm:table-cell px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colDefault')}</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colThisMonth')}</th>
            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{tc('actions')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
          {fixedExpenses.map((expense) => {
            const isSkipped = expense.override === 0
            const hasOverride = expense.override != null && expense.override > 0 && expense.override !== expense.amount_vnd
            const thisMonth = expense.override ?? expense.amount_vnd
            return (
              <tr key={expense.expense_id} className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 ${isSkipped ? 'opacity-60' : ''}`}>
                <td className="px-4 py-3 text-base font-medium text-gray-900 dark:text-gray-100">{expense.expense_name}</td>
                <td className="hidden sm:table-cell px-4 py-3 text-sm text-gray-600 dark:text-gray-400 text-right">{fmt(expense.amount_vnd)}</td>
                <td className="px-4 py-3 text-right">
                  {isSkipped ? (
                    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                      {t('skipped')}
                    </span>
                  ) : (
                    <div className={`text-sm font-medium ${hasOverride ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-gray-100'}`}>
                      <div>{fmt(thisMonth)}</div>
                      {hasOverride && <div className="text-xs">{t('overridden')}</div>}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="flex gap-1 justify-center">
                    {isSkipped ? (
                      <button onClick={() => handleRestore(expense)} className="h-8 px-2 text-xs font-medium text-gray-900 dark:text-gray-100 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">{t('restore')}</button>
                    ) : (
                      <>
                        <button onClick={() => openEdit(expense)} className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                          <Edit className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        </button>
                        <button onClick={() => setConfirmSkip(expense)} className="h-8 px-2 text-xs font-medium text-gray-900 dark:text-gray-100 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">{t('skip')}</button>
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
      <Dialog open={!!editItem} onOpenChange={(o) => { if (!o && !saving) setEditItem(null) }}>
        <DialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('overrideModal')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); handleSaveOverride() }}>
            <div className="space-y-5 py-4">
              {editItem && <p className="text-sm text-gray-500 dark:text-gray-400">{editItem.expense_name}</p>}
              {formError && <p className="text-red-600 dark:text-red-400 text-sm">{formError}</p>}
              <div className="space-y-2">
                <Label>{t('overrideLabel')}</Label>
                <div className="flex gap-2">
                  <Input type="text" inputMode="numeric" value={overrideValue ? Number(overrideValue).toLocaleString('vi-VN') : ''} onChange={(e) => setOverrideValue(e.target.value.replace(/\./g, '').replace(/[^0-9]/g, ''))} />
                  {editItem && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setOverrideValue(String(editItem.amount_vnd))}
                      className="shrink-0 whitespace-nowrap"
                    >
                      {t('colDefault')}
                    </Button>
                  )}
                </div>
                {editItem && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t('defaultPerMonth', { amount: fmt(editItem.amount_vnd) })}</p>}
              </div>
            </div>
            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setEditItem(null)}>{tc('cancel')}</Button>
              <Button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-700" disabled={saving}>
                {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {saving ? tc('saving') : tc('save')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Skip Confirmation */}
      <Dialog open={!!confirmSkip} onOpenChange={(o) => { if (!o) setConfirmSkip(null) }}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              {t('skipModal')}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            {confirmSkip && (
              <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                {t('skipMessage', { name: confirmSkip.expense_name })}
              </p>
            )}
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => setConfirmSkip(null)}>{tc('cancel')}</Button>
            <Button className="flex-1 bg-red-600 hover:bg-red-700" onClick={() => confirmSkip && handleSkip(confirmSkip)}>{t('skipConfirm')}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
