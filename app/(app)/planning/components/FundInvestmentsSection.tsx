'use client'

import { useState } from 'react'
import { Plus, Edit, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
      units: inv.units != null ? String(inv.units) : '',
      unit_price: inv.unit_price != null ? String(inv.unit_price) : '',
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
      <div className="flex items-center justify-between px-5 py-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('fundInvestmentsTitle')}</h2>
        <button onClick={openAdd} className="flex items-center gap-2 h-9 px-4 bg-gray-950 hover:bg-gray-800 text-white text-sm font-bold rounded-md transition-colors">
          <Plus className="h-3.5 w-3.5" />
          {t('addFundInvestment')}
        </button>
      </div>

      {investments.length === 0 ? (
        <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">{t('addFundInvestmentDesc')}</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colFund')}</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colDate')}</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colAmount')}</th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colUnits')}</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colGoalCol')}</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{tc('actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {investments.map((inv) => (
              <tr key={inv.transaction_id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td className="px-4 py-3 text-base font-medium text-gray-900 dark:text-gray-100">
                  <span>{inv.funds?.name ?? '—'}</span>
                  {inv.is_dca_seeded && (
                    <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 font-medium">DCA</span>
                  )}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{inv.investment_date ?? '—'}</td>
                <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100 text-right">{fmt(inv.amount_vnd)}</td>
                <td className="px-4 py-3 text-sm text-right">
                  {inv.units != null
                    ? <span className="text-gray-600 dark:text-gray-400">{inv.units}</span>
                    : <span className="text-amber-500 dark:text-amber-400 italic">Pending</span>
                  }
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs ${inv.savings_goals ? 'font-medium bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'font-medium bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-gray-100'}`}>
                    {inv.savings_goals?.goal_name ?? t('unassigned')}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="flex gap-1 justify-center">
                    <button onClick={() => openEdit(inv)} className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                      <Edit className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    </button>
                    <button onClick={() => setConfirmDelete(inv)} className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
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
        <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editItem ? t('editFundModal') : t('addFundModal')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); handleSave() }}>
            <div className="space-y-5 py-4">
              {formError && <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>}
              <div className="space-y-2">
                <Label>{t('colFund')} <span className="text-red-500">*</span></Label>
                <Select value={form.fund_id || undefined} onValueChange={(v) => handleFundSelect(v || '')}>
                  <SelectTrigger><SelectValue placeholder={t('selectFund')}>{form.fund_id ? funds.find(f => f.id === form.fund_id)?.name : undefined}</SelectValue></SelectTrigger>
                  <SelectContent>
                    {funds.map((f) => (
                      <SelectItem key={f.id} value={f.id}>{f.name} (NAV: {f.nav})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t('dateLabel')} <span className="text-red-500">*</span></Label>
                <Input type="date" value={form.investment_date} min={minDate} max={maxDate}
                  onChange={(e) => setForm((prev) => ({ ...prev, investment_date: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>{t('goalLabel')}</Label>
                <Select value={form.goal_id || 'unassigned'} onValueChange={(v) => setForm({ ...form, goal_id: !v || v === 'unassigned' ? '' : v })} disabled={goals.length === 0}>
                  <SelectTrigger><SelectValue>{form.goal_id ? goals.find(g => g.goal_id === form.goal_id)?.goal_name : (goals.length === 0 ? t('noGoals') : t('unassigned'))}</SelectValue></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">{goals.length === 0 ? t('noGoals') : t('unassigned')}</SelectItem>
                    {goals.map((g) => <SelectItem key={g.goal_id} value={g.goal_id}>{g.goal_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t('amountLabel')} <span className="text-red-500">*</span></Label>
                <Input type="number" value={form.amount_vnd} onChange={(e) => setForm({ ...form, amount_vnd: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('unitsLabel')} <span className="text-red-500">*</span></Label>
                  <Input type="number" step="0.0001" placeholder="e.g., 450.25" value={form.units} onChange={(e) => setForm({ ...form, units: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>{t('navAtPurchaseLabel')} <span className="text-red-500">*</span></Label>
                  <Input type="number" step="0.0001" placeholder="e.g., 22215.12" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} />
                </div>
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
            <DialogTitle>{t('deleteFundModal')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{t('deleteFundMessage')}</p>
          <div className="flex gap-3 mt-4">
            <Button variant="outline" className="flex-1" onClick={() => setConfirmDelete(null)}>{tc('cancel')}</Button>
            <Button className="flex-1 bg-red-600 hover:bg-red-700" onClick={() => confirmDelete && handleDelete(confirmDelete)}>{tc('confirm')}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
