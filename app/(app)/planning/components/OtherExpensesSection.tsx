'use client'

import { useState } from 'react'
import { Plus, Edit, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import type { MonthlyPlan, OtherExpense } from '../PlanningClient'

interface Props {
  plan: MonthlyPlan
  otherExpenses: OtherExpense[]
  onRefresh: () => void
  onToast: (msg: string) => void
}

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')

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
        <button onClick={openAdd} className="flex items-center gap-2 h-9 px-4 bg-gray-950 hover:bg-gray-800 text-white text-sm font-bold rounded-md transition-colors">
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

      {/* Add/Edit Modal */}
      <Dialog open={showForm} onOpenChange={(o) => { if (!o && !saving) setShowForm(false) }}>
        <DialogContent className="sm:max-w-[420px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editItem ? t('editOtherModal') : t('addOtherModal')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); handleSave() }}>
            <div className="space-y-5 py-4">
              {formError && <p className="text-red-600 dark:text-red-400 text-sm">{formError}</p>}
              <div className="space-y-2">
                <Label>{t('descLabel')} <span className="text-red-500">*</span></Label>
                <Input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder={t('descPlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('amountLabel')} <span className="text-red-500">*</span></Label>
                <Input
                  type="number"
                  value={form.amount_vnd}
                  onChange={(e) => setForm({ ...form, amount_vnd: e.target.value })}
                  placeholder="e.g., 15000000"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setShowForm(false)}>{tc('cancel')}</Button>
              <Button type="submit" className="flex-1 bg-violet-600 hover:bg-violet-700" disabled={saving}>
                {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {saving ? tc('saving') : tc('save')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null) }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>{t('deleteOtherModal')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">{t('deleteOtherMessage')}</p>
          {confirmDelete && <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-5">{confirmDelete.description} — {fmt(confirmDelete.amount_vnd)}</p>}
          <div className="flex gap-3 mt-4">
            <Button variant="outline" className="flex-1" onClick={() => setConfirmDelete(null)} disabled={deleting}>{tc('cancel')}</Button>
            {confirmDelete && (
              <Button className="flex-1 bg-red-600 hover:bg-red-700" onClick={() => handleDelete(confirmDelete)} disabled={deleting}>
                {deleting ? tc('deleting') : tc('confirm')}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
