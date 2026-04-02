'use client'

import { useState } from 'react'
import { Plus, Edit, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { MonthlyPlan, OtherExpense } from '../PlanningClient'

interface Props {
  plan: MonthlyPlan
  otherExpenses: OtherExpense[]
  onRefresh: () => void
  onToast: (msg: string) => void
}

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')
const inputCls = 'w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500'

export default function OtherExpensesSection({ plan, otherExpenses, onRefresh, onToast }: Props) {
  const t = useTranslations('planning')
  const tc = useTranslations('common')
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<OtherExpense | null>(null)
  const [form, setForm] = useState({ description: '', amount_vnd: '' })
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<OtherExpense | null>(null)
  const [deleting, setDeleting] = useState(false)

  function openAdd() {
    setEditItem(null)
    setForm({ description: '', amount_vnd: '' })
    setFormError('')
    setShowForm(true)
  }

  function openEdit(item: OtherExpense) {
    setEditItem(item)
    setForm({ description: item.description, amount_vnd: String(item.amount_vnd) })
    setFormError('')
    setShowForm(true)
  }

  async function handleSave() {
    setFormError('')
    if (!form.description.trim()) {
      setFormError(t('descRequired'))
      return
    }
    const amountNum = Number(form.amount_vnd)
    if (!form.amount_vnd || isNaN(amountNum) || amountNum <= 0) {
      setFormError(t('amountRequired'))
      return
    }

    setSaving(true)
    const url = editItem
      ? `/api/v1/monthly-plans/${plan.id}/other-expenses/${editItem.id}`
      : `/api/v1/monthly-plans/${plan.id}/other-expenses`
    try {
      const res = await fetch(url, {
        method: editItem ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: form.description.trim(), amount_vnd: amountNum }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        setFormError(error ?? t('cannotSave'))
      } else {
        setShowForm(false)
        onToast(editItem ? t('otherUpdated') : t('otherAdded'))
        onRefresh()
      }
    } catch {
      setFormError(t('cannotSave'))
    }
    setSaving(false)
  }

  async function handleDelete(item: OtherExpense) {
    setDeleting(true)
    const res = await fetch(`/api/v1/monthly-plans/${plan.id}/other-expenses/${item.id}`, { method: 'DELETE' })
    if (res.ok) {
      setConfirmDelete(null)
      onToast(t('otherDeleted'))
      onRefresh()
    }
    setDeleting(false)
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('otherExpensesTitle')}</h2>
        <button onClick={openAdd} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-700 dark:hover:bg-gray-200 transition-colors">
          <Plus className="h-3.5 w-3.5" />
          {t('addOtherExpense')}
        </button>
      </div>

      {otherExpenses.length === 0 ? (
        <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">{t('addOtherExpenseDesc')}</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colDescription')}</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{tc('amount')}</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{tc('actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {otherExpenses.map((item) => (
              <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td className="px-4 py-3 text-base font-medium text-gray-900 dark:text-gray-100">{item.description}</td>
                <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100 text-right">{fmt(item.amount_vnd)}</td>
                <td className="px-4 py-3 text-center">
                  <div className="flex gap-1 justify-center">
                    <button onClick={() => openEdit(item)} className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                      <Edit className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    </button>
                    <button onClick={() => setConfirmDelete(item)} className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                      <Trash2 className="h-4 w-4 text-red-600 dark:text-red-400" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Add Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={(e) => { e.preventDefault(); handleSave() }} className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm p-6 border border-gray-100 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{editItem ? t('editOtherModal') : t('addOtherModal')}</h3>
            {formError && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{formError}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('descLabel')}</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder={t('descPlaceholder')}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('amountLabel')}</label>
                <input
                  type="number"
                  value={form.amount_vnd}
                  onChange={(e) => setForm({ ...form, amount_vnd: e.target.value })}
                  className={inputCls}
                />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">{tc('cancel')}</button>
              <button type="submit" disabled={saving} className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {saving ? tc('saving') : tc('save')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm p-6 border border-gray-100 dark:border-gray-700">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">{t('deleteOtherModal')}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">{t('deleteOtherMessage')}</p>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-5">{confirmDelete.description} — {fmt(confirmDelete.amount_vnd)}</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} disabled={deleting} className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">{tc('cancel')}</button>
              <button onClick={() => handleDelete(confirmDelete)} disabled={deleting} className="flex-1 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50">
                {deleting ? tc('deleting') : tc('confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
