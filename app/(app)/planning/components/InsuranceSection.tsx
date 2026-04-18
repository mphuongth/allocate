'use client'

import { useState } from 'react'
import { Edit, AlertTriangle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import type { MonthlyPlan, InsuranceMember } from '../PlanningClient'

interface Props {
  plan: MonthlyPlan
  insuranceMembers: InsuranceMember[]
  onRefresh: () => void
  onToast: (msg: string) => void
}

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')


export default function InsuranceSection({ plan, insuranceMembers, onRefresh, onToast }: Props) {
  const t = useTranslations('planning')
  const tc = useTranslations('common')
  const [editItem, setEditItem] = useState<InsuranceMember | null>(null)
  const [overrideValue, setOverrideValue] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmSkip, setConfirmSkip] = useState<InsuranceMember | null>(null)

  function openEdit(member: InsuranceMember) {
    setEditItem(member)
    const defaultMonthly = Math.round(member.annual_payment_vnd / 12)
    setOverrideValue(String(member.monthlyOverride ?? defaultMonthly))
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
      const res = await fetch(`/api/v1/monthly-plans/${plan.id}/insurance-overrides`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: editItem.member_id, monthly_amount_override_vnd: num }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        setFormError(error ?? t('cannotSave'))
      } else {
        setEditItem(null)
        onToast(t('insuranceSaved'))
        onRefresh()
      }
    } catch {
      setFormError(t('cannotSave'))
    }
    setSaving(false)
  }

  async function handleSkip(member: InsuranceMember) {
    await fetch(`/api/v1/monthly-plans/${plan.id}/excluded-insurance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_id: member.member_id }),
    })
    setConfirmSkip(null)
    onToast(t('insuranceSkipped', { name: member.member_name }))
    onRefresh()
  }

  async function handleRestore(member: InsuranceMember) {
    await fetch(`/api/v1/monthly-plans/${plan.id}/excluded-insurance/${member.member_id}`, { method: 'DELETE' })
    onToast(t('insuranceRestored', { name: member.member_name }))
    onRefresh()
  }

  if (insuranceMembers.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="px-5 py-4">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">{t('insuranceTitle')}</h2>
        </div>
        <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">{t('insuranceDesc')}</div>
      </div>
    )
  }

  const totalMonthly = insuranceMembers.reduce((sum, m) => {
    if (m.excluded) return sum
    return sum + (m.monthlyOverride ?? Math.round(m.annual_payment_vnd / 12))
  }, 0)

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="px-5 py-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('insuranceTitle')}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('insuranceDesc')}</p>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700">
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colMember')}</th>
            <th className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colRelationship')}</th>
            <th className="hidden sm:table-cell px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colDefault')}</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colThisMonth')}</th>
            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{tc('actions')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
          {insuranceMembers.map((m) => {
            const defaultMonthly = Math.round(m.annual_payment_vnd / 12)
            const hasOverride = m.monthlyOverride != null && m.monthlyOverride !== defaultMonthly
            return (
              <tr key={m.member_id} className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 ${m.excluded ? 'opacity-60' : ''}`}>
                <td className="px-4 py-3 text-base font-medium text-gray-900 dark:text-gray-100">{m.member_name}</td>
                <td className="hidden sm:table-cell px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{m.relationship}</td>
                <td className="hidden sm:table-cell px-4 py-3 text-sm text-gray-600 dark:text-gray-400 text-right">{fmt(defaultMonthly)}</td>
                <td className="px-4 py-3 text-right">
                  {m.excluded ? (
                    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                      {t('skipped')}
                    </span>
                  ) : (
                    <div className={`text-sm font-medium ${hasOverride ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-gray-100'}`}>
                      <div>{fmt(m.monthlyOverride ?? defaultMonthly)}</div>
                      {hasOverride && <div className="text-xs">{t('overridden')}</div>}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="flex gap-1 justify-center">
                    {m.excluded ? (
                      <button onClick={() => handleRestore(m)} className="h-8 px-2 text-xs font-medium text-gray-900 dark:text-gray-100 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">{t('restore')}</button>
                    ) : (
                      <>
                        <button onClick={() => openEdit(m)} className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                          <Edit className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        </button>
                        <button onClick={() => setConfirmSkip(m)} className="h-8 px-2 text-xs font-medium text-gray-900 dark:text-gray-100 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">{t('skip')}</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="px-4 mt-4 flex items-center justify-between border-t border-gray-200 dark:border-gray-700 pt-4 pb-4">
        <span className="text-base font-medium text-gray-900 dark:text-gray-100">{t('colTotalMonth')}</span>
        <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">{fmt(totalMonthly)}</span>
      </div>

      {/* Edit Override Modal */}
      <Dialog open={!!editItem} onOpenChange={(o) => { if (!o && !saving) setEditItem(null) }}>
        <DialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('overrideModal')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); handleSaveOverride() }}>
            <div className="space-y-5 py-4">
              {editItem && <p className="text-sm text-gray-500 dark:text-gray-400">{editItem.member_name}</p>}
              {formError && <p className="text-red-600 dark:text-red-400 text-sm">{formError}</p>}
              <div className="space-y-2">
                <Label>{t('overrideLabel')}</Label>
                <div className="flex gap-2">
                  <Input type="number" value={overrideValue} onChange={(e) => setOverrideValue(e.target.value)} />
                  {editItem && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setOverrideValue(String(Math.round(editItem.annual_payment_vnd / 12)))}
                      className="shrink-0 whitespace-nowrap"
                    >
                      {t('colDefault')}
                    </Button>
                  )}
                </div>
                {editItem && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t('defaultPerMonthInsurance', { amount: fmt(Math.round(editItem.annual_payment_vnd / 12)) })}</p>}
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
                {t('skipMessage', { name: confirmSkip.member_name })}
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
