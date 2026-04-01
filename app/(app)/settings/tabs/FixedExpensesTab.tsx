'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
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
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('title')}</h2>
          {expenses.length > 0 && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('total')}: {fmt(totalMonthly)} {t('perMonth')}</p>}
        </div>
        <button onClick={openCreate} className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700">
          {t('create')}
        </button>
      </div>

      {successMsg && (
        <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-300 rounded-lg text-sm">{successMsg}</div>
      )}

      {/* Filter */}
      {categories.length > 0 && (
        <div className="mb-4 flex items-center gap-3">
          <label className="text-sm text-gray-600 dark:text-gray-400 font-medium">{t('filterCategory')}</label>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">{t('filterAll')}</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {loading ? (
          <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">{tCommon('loading')}</div>
        ) : expenses.length === 0 ? (
          <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">{t('empty')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                {[t('colName'), t('colCategory'), t('colAmount'), t('colCreated'), tCommon('actions')].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {expenses.map((expense) => (
                <tr key={expense.expense_id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{expense.expense_name}</td>
                  <td className="px-4 py-3">
                    <span className="inline-block px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-medium">{expense.category}</span>
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{fmt(expense.amount_vnd)}</td>
                  <td className="px-4 py-3 text-gray-400 dark:text-gray-500 text-xs">{new Date(expense.created_at).toLocaleDateString('vi-VN')}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-3">
                      <button onClick={() => openEdit(expense)} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">{tCommon('edit')}</button>
                      <button onClick={() => setConfirmExpense(expense)} className="text-xs text-red-500 dark:text-red-400 hover:underline">
                        {tCommon('delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
