'use client'

import { useState, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { AlertTriangle } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { MonthlyPlan } from '../PlanningClient'

interface Props {
  plan: MonthlyPlan | null
  month: number
  year: number
  onPlanCreated: (plan: MonthlyPlan) => void
  onPlanDeleted: () => void
}

export default function SalaryInput({ plan, month, year, onPlanCreated, onPlanDeleted }: Props) {
  const t = useTranslations('planning')
  const tc = useTranslations('common')
  const MONTHS = t('months').split(',')

  const [value, setValue] = useState(plan ? String(plan.salary_vnd) : '')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState('')
  const prevPlanId = useRef(plan?.id)

  // Reset when plan changes (month navigation)
  if (plan?.id !== prevPlanId.current) {
    prevPlanId.current = plan?.id
    setValue(plan ? String(plan.salary_vnd) : '')
  }

  async function saveSalary() {
    const num = Number(value)
    if (!value || isNaN(num) || num <= 0) {
      setError(t('salaryRequired'))
      return
    }
    setError('')
    setSaving(true)

    try {
      if (plan) {
        const res = await fetch(`/api/v1/monthly-plans/${plan.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ salary_vnd: num }),
        })
        if (!res.ok) {
          const { error: e } = await res.json()
          setError(e ?? t('salaryError'))
        }
      } else {
        const res = await fetch('/api/v1/monthly-plans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ month, year, salary_vnd: num }),
        })
        if (res.ok) {
          const newPlan = await res.json()
          onPlanCreated(newPlan)
        } else {
          const { error: e } = await res.json()
          setError(e ?? t('salaryError'))
        }
      }
    } catch {
      setError(t('salaryCannotSave'))
    }
    setSaving(false)
  }

  async function confirmDelete() {
    if (!plan) return
    setDeleting(true)
    setShowConfirm(false)
    try {
      const res = await fetch(`/api/v1/monthly-plans/${plan.id}`, { method: 'DELETE' })
      if (res.ok) {
        onPlanDeleted()
      } else {
        const { error: e } = await res.json()
        setError(e ?? t('deleteSalaryError'))
      }
    } catch {
      setError(t('deleteSalaryCannotDelete'))
    }
    setDeleting(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') saveSalary()
  }

  return (
    <>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
        <div className="flex items-center justify-between mb-4">
          <label className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('salaryLabel')}</label>
          {plan && (
            <button
              onClick={() => setShowConfirm(true)}
              disabled={deleting || saving}
              className="px-3 h-9 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {deleting ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                tc('delete')
              )}
            </button>
          )}
        </div>
        {error && <p className="text-red-600 dark:text-red-400 text-sm mb-2">{error}</p>}
        <div className="flex items-center gap-3">
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={saveSalary}
            onKeyDown={handleKeyDown}
            disabled={saving}
            placeholder={t('salaryPlaceholder')}
            className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-md text-lg font-medium bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
          />
          {saving && (
            <div className="w-5 h-5 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
          )}
        </div>
      </div>

      {/* Confirmation modal */}
      <Dialog open={showConfirm} onOpenChange={(o) => { if (!o) setShowConfirm(false) }}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              {t('deleteSalaryModal')}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
              {t.rich('deleteSalaryMessage', {
                month: MONTHS[month - 1],
                year,
                b: (chunks) => <span className="font-semibold text-gray-900 dark:text-gray-100">{chunks}</span>,
              })}
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => setShowConfirm(false)}>{tc('cancel')}</Button>
            <Button className="flex-1 bg-red-600 hover:bg-red-700" onClick={confirmDelete}>{tc('delete')}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
