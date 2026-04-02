'use client'

import { useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { MonthlyPlan, FundInvestment, Fund, Goal } from '../PlanningClient'

interface Props {
  plan: MonthlyPlan
  investments: FundInvestment[]
  funds: Fund[]
  goals: Goal[]
  onRefresh: () => void
  onToast: (msg: string) => void
}

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')

const emptyForm = { fund_id: '', goal_id: '', amount_vnd: '', units: '', unit_price: '', investment_date: '' }

const inputCls = 'w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500'

export default function FundInvestmentsSection({ plan, investments, funds, goals, onRefresh, onToast }: Props) {
  const t = useTranslations('planning')
  const tc = useTranslations('common')
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState<FundInvestment | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<FundInvestment | null>(null)

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
      units: String(inv.units),
      unit_price: String(inv.unit_price),
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
      unit_price: fund ? String(fund.nav) : prev.unit_price,
    }))
  }

  async function handleSave() {
    setFormError('')
    if (!form.fund_id) { setFormError(t('fundRequired')); return }
    if (!form.investment_date) { setFormError(t('dateRequired')); return }
    if (!form.amount_vnd || Number(form.amount_vnd) <= 0) { setFormError(t('amountUnitsRequired')); return }
    if (!form.units || Number(form.units) <= 0) { setFormError(t('amountUnitsRequired')); return }
    if (!form.unit_price || Number(form.unit_price) <= 0) { setFormError(t('navRequiredPositive')); return }

    setSaving(true)
    const payload = {
      asset_type: 'fund',
      plan_id: plan.id,
      fund_id: form.fund_id,
      goal_id: form.goal_id || null,
      amount_vnd: Number(form.amount_vnd),
      units: Number(form.units),
      unit_price: Number(form.unit_price),
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
        setFormError(error ?? t('cannotSave'))
      } else {
        setShowForm(false)
        onToast(editItem ? t('fundUpdated') : t('fundAdded'))
        onRefresh()
      }
    } catch {
      setFormError(t('cannotSave'))
    }
    setSaving(false)
  }

  async function handleDelete(inv: FundInvestment) {
    const res = await fetch(`/api/v1/investment-transactions/${inv.transaction_id}`, { method: 'DELETE' })
    if (res.ok) {
      setConfirmDelete(null)
      onToast(t('fundDeleted'))
      onRefresh()
    }
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('fundInvestmentsTitle')}</h2>
        <button onClick={openAdd} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-700 dark:hover:bg-gray-200 transition-colors">
          <Plus className="h-3.5 w-3.5" />
          {t('addFundInvestment')}
        </button>
      </div>

      {investments.length === 0 ? (
        <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">{t('addFundInvestmentDesc')}</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-700">
              {[t('colFund'), t('colDate'), t('colAmount'), t('colUnits'), t('colGoalCol'), tc('actions')].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
            {investments.map((inv) => (
              <tr key={inv.transaction_id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td className="px-4 py-3 font-semibold text-gray-900 dark:text-gray-100 text-base">{inv.funds?.name ?? '—'}</td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{inv.investment_date ?? '—'}</td>
                <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{fmt(inv.amount_vnd)}</td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{inv.units}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2.5 py-0.5 rounded-md text-xs ${inv.savings_goals ? 'font-medium bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'font-normal border border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500'}`}>
                    {inv.savings_goals?.goal_name ?? t('unassigned')}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <button onClick={() => openEdit(inv)} className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                      <Pencil className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    </button>
                    <button onClick={() => setConfirmDelete(inv)} className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                      <Trash2 className="h-4 w-4 text-red-500 dark:text-red-400" />
                    </button>
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
          <form onSubmit={(e) => { e.preventDefault(); handleSave() }} className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto border border-gray-100 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{editItem ? t('editFundModal') : t('addFundModal')}</h3>
            {formError && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{formError}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('colFund')} *</label>
                <select value={form.fund_id} onChange={(e) => handleFundSelect(e.target.value)} className={inputCls}>
                  <option value="">{t('selectFund')}</option>
                  {funds.map((f) => (
                    <option key={f.id} value={f.id}>{f.name} (NAV: {f.nav})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('dateLabel')}</label>
                <input type="date" value={form.investment_date} min={minDate} max={maxDate}
                  onChange={(e) => setForm((prev) => ({ ...prev, investment_date: e.target.value }))}
                  className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('goalLabel')}</label>
                <select value={form.goal_id} onChange={(e) => setForm({ ...form, goal_id: e.target.value })}
                  disabled={goals.length === 0} className={`${inputCls} disabled:opacity-50`}>
                  <option value="">{goals.length === 0 ? t('noGoals') : t('unassigned')}</option>
                  {goals.map((g) => <option key={g.goal_id} value={g.goal_id}>{g.goal_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('amountLabel')}</label>
                <input type="number" value={form.amount_vnd} onChange={(e) => setForm({ ...form, amount_vnd: e.target.value })} className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('unitsLabel')}</label>
                  <input type="number" step="0.0001" value={form.units} onChange={(e) => setForm({ ...form, units: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('navAtPurchaseLabel')}</label>
                  <input type="number" step="0.0001" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} className={inputCls} />
                </div>
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
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">{t('deleteFundModal')}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-5">{t('deleteFundMessage')}</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">{tc('cancel')}</button>
              <button onClick={() => handleDelete(confirmDelete)} className="flex-1 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700">{tc('confirm')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
