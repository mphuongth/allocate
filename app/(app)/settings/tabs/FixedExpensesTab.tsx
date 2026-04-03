'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Plus, Edit, Trash2, ChevronDown } from 'lucide-react'
import ConfirmModal from '@/app/components/ConfirmModal'

interface Expense {
  expense_id: string
  expense_name: string
  amount_vnd: number
  category: string
  created_at: string
}

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')

const emptyForm = { expense_name: '', amount_vnd: '', category: '' }

const FIXED_CACHE_PREFIX = 'fixedExpensesCache'
const CACHE_TTL = 2 * 60 * 1000
function getFixedCache(category: string): Expense[] | null {
  try {
    const raw = localStorage.getItem(`${FIXED_CACHE_PREFIX}_${category}`)
    if (!raw) return null
    const { data, ts } = JSON.parse(raw)
    if (Date.now() - ts > CACHE_TTL) return null
    return data
  } catch { return null }
}
function setFixedCache(category: string, data: Expense[]) {
  try { localStorage.setItem(`${FIXED_CACHE_PREFIX}_${category}`, JSON.stringify({ data, ts: Date.now() })) } catch {}
}
function bustFixedCache() {
  try {
    Object.keys(localStorage).filter(k => k.startsWith(FIXED_CACHE_PREFIX)).forEach(k => localStorage.removeItem(k))
  } catch {}
}

export default function FixedExpensesTab() {
  const t = useTranslations('expenses')
  const tCommon = useTranslations('common')
  const [expenses, setExpenses] = useState<Expense[]>(() => getFixedCache('') ?? [])
  const [loading, setLoading] = useState(() => !getFixedCache(''))
  const [filterCategory, setFilterCategory] = useState('')
  const [categories, setCategories] = useState<string[]>(() => {
    const cached = getFixedCache('')
    return cached ? [...new Set<string>(cached.map(e => e.category))] : []
  })
  const [showForm, setShowForm] = useState(false)
  const [editExpense, setEditExpense] = useState<Expense | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmExpense, setConfirmExpense] = useState<Expense | null>(null)
  const [successMsg, setSuccessMsg] = useState('')

  const fetchExpenses = useCallback(async (opts?: { force?: boolean }) => {
    if (opts?.force) bustFixedCache()
    const params = new URLSearchParams()
    if (filterCategory) params.set('category', filterCategory)
    const res = await fetch(`/api/v1/fixed-expenses?${params}`)
    const { expenses } = await res.json()
    const list: Expense[] = expenses ?? []
    setFixedCache(filterCategory, list)
    setExpenses(list)
    if (!filterCategory && list.length) {
      setCategories([...new Set<string>(list.map((e: Expense) => e.category))])
    }
    setLoading(false)
  }, [filterCategory])

  useEffect(() => { fetchExpenses() }, [fetchExpenses])

  function openCreate() {
    setEditExpense(null)
    setForm(emptyForm)
    setFormError('')
    setShowForm(true)
  }

  function openEdit(expense: Expense) {
    setEditExpense(expense)
    setForm({ expense_name: expense.expense_name, amount_vnd: String(expense.amount_vnd), category: expense.category })
    setFormError('')
    setShowForm(true)
  }

  async function handleSave() {
    setFormError('')
    if (!form.expense_name.trim()) { setFormError(t('nameRequired')); return }
    if (!form.category.trim()) { setFormError(t('categoryRequired')); return }
    if (!form.amount_vnd || Number(form.amount_vnd) <= 0) { setFormError(t('amountRequired')); return }

    setSaving(true)
    const url = editExpense ? `/api/v1/fixed-expenses/${editExpense.expense_id}` : '/api/v1/fixed-expenses'
    const res = await fetch(url, {
      method: editExpense ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expense_name: form.expense_name, amount_vnd: Number(form.amount_vnd), category: form.category }),
    })
    if (!res.ok) {
      const { error } = await res.json()
      setFormError(error ?? tCommon('error'))
    } else {
      setShowForm(false)
      await fetchExpenses({ force: true })
    }
    setSaving(false)
  }

  async function handleDelete(expense: Expense) {
    setDeletingId(expense.expense_id)
    const res = await fetch(`/api/v1/fixed-expenses/${expense.expense_id}`, { method: 'DELETE' })
    if (res.ok) {
      setConfirmExpense(null)
      setSuccessMsg(t('deleted'))
      setTimeout(() => setSuccessMsg(''), 4000)
      await fetchExpenses({ force: true })
    }
    setDeletingId(null)
  }

  const totalMonthly = expenses.reduce((s, e) => s + e.amount_vnd, 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('title')}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('total')}: {fmt(totalMonthly)} {t('perMonth')}</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 h-9 px-4 bg-gray-950 hover:bg-gray-800 text-white text-sm font-bold rounded-md transition-colors">
          <Plus className="h-4 w-4" />
          {t('create')}
        </button>
      </div>

      {successMsg && (
        <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-300 rounded-lg text-sm">{successMsg}</div>
      )}

      {/* Category Filter */}
      {categories.length > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-black/10 dark:border-gray-700 p-4">
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium text-gray-900 dark:text-gray-100 shrink-0">{t('filterCategory')}</label>
            <div className="relative">
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="appearance-none border border-black/10 dark:border-gray-600 rounded-lg px-3 py-2 pr-8 text-sm font-medium bg-[#f3f3f5] dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">{t('filterAll')}</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-black/10 dark:border-gray-700 overflow-hidden">
        {loading ? (
          <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">{tCommon('loading')}</div>
        ) : expenses.length === 0 ? (
          <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">{t('empty')}</div>
        ) : (
          <div className="overflow-x-auto p-6">
            <table className="w-full">
              <thead>
                <tr className="border-b border-black/10 dark:border-gray-700 text-left">
                  <th className="px-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colName')}</th>
                  <th className="px-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colCategory')}</th>
                  <th className="px-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase text-right">{t('colAmount')}</th>
                  <th className="px-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colCreated')}</th>
                  <th className="px-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase text-center">{tCommon('actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5 dark:divide-gray-700">
                {expenses.map((expense) => (
                  <tr key={expense.expense_id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td className="px-4 py-4 font-medium text-gray-900 dark:text-gray-100">{expense.expense_name}</td>
                    <td className="px-4 py-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">{expense.category}</span>
                    </td>
                    <td className="px-4 py-4 text-right font-semibold text-gray-900 dark:text-gray-100">{fmt(expense.amount_vnd)}</td>
                    <td className="px-4 py-4 text-sm text-gray-600 dark:text-gray-400">{new Date(expense.created_at).toLocaleDateString('vi-VN')}</td>
                    <td className="px-4 py-4 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openEdit(expense)} className="h-8 w-8 p-0 flex items-center justify-center border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                          <Edit className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        </button>
                        <button onClick={() => setConfirmExpense(expense)} className="h-8 w-8 p-0 flex items-center justify-center border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                          <Trash2 className="h-4 w-4 text-red-500 dark:text-red-400" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Info Card */}
      <div className="p-6 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500 text-white shrink-0">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h4 className="font-medium text-amber-900 dark:text-amber-200 mb-1">{t('infoTitle')}</h4>
            <p className="text-sm text-amber-800 dark:text-amber-300">{t('infoDesc')}</p>
          </div>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={(e) => { e.preventDefault(); handleSave() }} className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm p-6 border border-gray-100 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{editExpense ? t('editModal') : t('createModal')}</h3>
            {formError && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{formError}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('nameLabel')}</label>
                <input type="text" value={form.expense_name} onChange={(e) => setForm({ ...form, expense_name: e.target.value })}
                  placeholder={t('namePlaceholder')} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('categoryLabel')}</label>
                <input type="text" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder={t('categoryPlaceholder')} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('amountLabel')}</label>
                <input type="number" value={form.amount_vnd} onChange={(e) => setForm({ ...form, amount_vnd: e.target.value })}
                  placeholder={t('amountPlaceholder')} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">{tCommon('cancel')}</button>
              <button type="submit" disabled={saving} className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {saving ? tCommon('saving') : tCommon('save')}
              </button>
            </div>
          </form>
        </div>
      )}

      {confirmExpense && (
        <ConfirmModal
          title={t('deleteModal')}
          message={t('deleteMessage')}
          detail={`${confirmExpense.expense_name} — ${fmt(confirmExpense.amount_vnd)}`}
          confirming={deletingId === confirmExpense.expense_id}
          onConfirm={() => handleDelete(confirmExpense)}
          onCancel={() => setConfirmExpense(null)}
        />
      )}
    </div>
  )
}
