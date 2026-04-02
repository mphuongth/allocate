'use client'

import { useState } from 'react'
import { Edit } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { MonthlyPlan, InsuranceMember } from '../PlanningClient'

interface Props {
  plan: MonthlyPlan
  insuranceMembers: InsuranceMember[]
  onRefresh: () => void
  onToast: (msg: string) => void
}

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')

const inputCls = 'w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500'

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
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
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
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('insuranceTitle')}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('insuranceDesc')}</p>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 dark:border-gray-700">
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colMember')}</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colRelationship')}</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colDefault')}</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colThisMonth')}</th>
            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{tc('actions')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
          {insuranceMembers.map((m) => {
            const defaultMonthly = Math.round(m.annual_payment_vnd / 12)
            const hasOverride = m.monthlyOverride != null && m.monthlyOverride !== defaultMonthly
            return (
              <tr key={m.member_id} className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 ${m.excluded ? 'opacity-60' : ''}`}>
                <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">{m.member_name}</td>
                <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{m.relationship}</td>
                <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 text-right">{fmt(defaultMonthly)}</td>
                <td className="px-4 py-3 text-right">
                  {m.excluded ? (
                    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                      {t('skipped')}
                    </span>
                  ) : (
                    <>
                      <span className={`text-sm font-medium ${hasOverride ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-gray-100'}`}>
                        {fmt(m.monthlyOverride ?? defaultMonthly)}
                      </span>
                      {hasOverride && <div className="text-xs text-amber-500 dark:text-amber-400">({t('overridden')})</div>}
                    </>
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
        <tfoot>
          <tr className="border-t border-gray-200 dark:border-gray-700">
            <td colSpan={3} className="px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-300">{t('colTotalMonth')}</td>
            <td colSpan={2} className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100">{fmt(totalMonthly)}</td>
          </tr>
        </tfoot>
      </table>

      {/* Edit Override Modal */}
      {editItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={(e) => { e.preventDefault(); handleSaveOverride() }} className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm p-6 border border-gray-100 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">{t('overrideModal')}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{editItem.member_name}</p>
            {formError && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{formError}</p>}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('overrideLabel')}</label>
              <div className="flex gap-2">
                <input type="number" value={overrideValue} onChange={(e) => setOverrideValue(e.target.value)} className={inputCls} />
                <button
                  type="button"
                  onClick={() => setOverrideValue(String(Math.round(editItem.annual_payment_vnd / 12)))}
                  className="shrink-0 px-3 py-2 text-xs font-medium text-indigo-600 dark:text-indigo-400 border border-indigo-300 dark:border-indigo-700 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 whitespace-nowrap"
                >
                  {t('colDefault')}
                </button>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t('defaultPerMonthInsurance', { amount: fmt(Math.round(editItem.annual_payment_vnd / 12)) })}</p>
            </div>
            <div className="flex gap-3 mt-5">
              <button type="button" onClick={() => setEditItem(null)} className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">{tc('cancel')}</button>
              <button type="submit" disabled={saving} className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {saving ? tc('saving') : tc('save')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Skip Confirmation */}
      {confirmSkip && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm p-6 border border-gray-100 dark:border-gray-700">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">{t('skipModal')}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-5">
              {t('skipMessage', { name: confirmSkip.member_name })}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmSkip(null)} className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">{tc('cancel')}</button>
              <button onClick={() => handleSkip(confirmSkip)} className="flex-1 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700">{t('skipConfirm')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
