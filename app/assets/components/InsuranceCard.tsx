'use client'

import { useState, useEffect, useCallback } from 'react'
import { Trash2, TriangleAlert } from 'lucide-react'
import { useTranslations } from 'next-intl'

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')

const fmtDate = (dateStr: string): string => {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: 'long', day: 'numeric', year: 'numeric',
    })
  } catch {
    return ''
  }
}

type DisplayStatus = 'overdue' | 'due' | 'not_due_yet'

function computeDisplayStatus(nextPaymentDate: string | null): DisplayStatus {
  if (!nextPaymentDate) return 'not_due_yet'
  try {
    const payment = new Date(nextPaymentDate)
    if (isNaN(payment.getTime())) return 'not_due_yet'
    const now = new Date()
    const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const paymentMs = new Date(payment.getFullYear(), payment.getMonth(), payment.getDate()).getTime()
    if (paymentMs < todayMs) return 'overdue'
    if (paymentMs === todayMs) return 'due'
    return 'not_due_yet'
  } catch {
    return 'not_due_yet'
  }
}

interface SavingsRecord {
  id: string
  amount_saved_vnd: number
  created_at: string
}

interface Props {
  insuranceId: string
  insuranceName: string
  coverageType: string | null
  annualPremium: number
  amountSaved: number
  savingsProgressPercentage: number
  status: 'on_track' | 'upcoming' | 'overdue' | 'completed'
  nextPaymentDate: string | null
  lastPaymentDate: string | null
  onSavingsChange?: () => void
}

const statusClassName: Record<DisplayStatus | 'completed', { className: string; icon?: boolean }> = {
  not_due_yet: { className: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' },
  due: { className: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' },
  overdue: { className: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400', icon: true },
  completed: { className: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400' },
}

export default function InsuranceCard({
  insuranceId, insuranceName, coverageType, annualPremium, amountSaved,
  savingsProgressPercentage, status, nextPaymentDate, lastPaymentDate, onSavingsChange,
}: Props) {
  const t = useTranslations('dashboard')
  const tc = useTranslations('common')

  const isCompleted = status === 'completed'
  const displayStatus: DisplayStatus | 'completed' = isCompleted ? 'completed' : computeDisplayStatus(nextPaymentDate)
  const cfg = statusClassName[displayStatus]
  const statusLabelMap: Record<DisplayStatus | 'completed', string> = {
    not_due_yet: t('statusNotDue'),
    due: t('statusDue'),
    overdue: t('statusOverdue'),
    completed: t('statusCompleted'),
  }
  const showMarkAsPaid = status === 'upcoming' || status === 'overdue'

  const [localAmountSaved, setLocalAmountSaved] = useState(amountSaved)
  const localProgress = Math.min(annualPremium > 0 ? (localAmountSaved / annualPremium) * 100 : 0, 100)

  const [inputAmount, setInputAmount] = useState('')
  const [savingsList, setSavingsList] = useState<SavingsRecord[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [markPaidLoading, setMarkPaidLoading] = useState(false)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchSavings = useCallback(async () => {
    const res = await fetch(`/api/v1/insurance-members/${insuranceId}/savings`)
    if (res.ok) {
      const { savings } = await res.json()
      setSavingsList(savings ?? [])
    }
  }, [insuranceId])

  useEffect(() => { fetchSavings() }, [fetchSavings])

  useEffect(() => {
    if (!showConfirm) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowConfirm(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showConfirm])

  async function handleAdd() {
    const amount = Number(inputAmount)
    if (!inputAmount || isNaN(amount) || amount <= 0) {
      showToast(t('savingsAmountRequired'), 'error')
      return
    }
    setIsLoading(true)
    const res = await fetch('/api/v1/insurance-savings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ insurance_member_id: insuranceId, amount_saved_vnd: amount }),
    })
    if (res.ok) {
      setInputAmount('')
      setLocalAmountSaved((prev) => prev + amount)
      await fetchSavings()
      showToast(t('savingsAdded'))
    } else {
      showToast(t('savingsAddFailed'), 'error')
    }
    setIsLoading(false)
  }

  async function handleDelete(id: string, amount: number) {
    setIsLoading(true)
    const res = await fetch(`/api/v1/insurance-savings/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setLocalAmountSaved((prev) => prev - amount)
      await fetchSavings()
      showToast(t('savingsDeleted'))
    } else {
      showToast(t('savingsDeleteFailed'), 'error')
    }
    setIsLoading(false)
  }

  async function handleMarkAsPaid() {
    setMarkPaidLoading(true)
    try {
      const res = await fetch(`/api/v1/insurance-members/${insuranceId}/mark-paid`, { method: 'POST' })
      if (res.ok) {
        setLocalAmountSaved(0)
        setShowConfirm(false)
        showToast(t('markPaidSuccess'))
        onSavingsChange?.()
      } else {
        const body = await res.json().catch(() => ({}))
        const msg = res.status === 401 ? t('markPaidUnauthorized')
          : res.status === 422 ? body.error ?? t('markPaidNotDue')
          : body.error ?? t('markPaidError')
        showToast(msg, 'error')
        setShowConfirm(false)
      }
    } catch {
      showToast(t('markPaidConnError'), 'error')
      setShowConfirm(false)
    }
    setMarkPaidLoading(false)
  }

  return (
    <div className={`bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 ${isCompleted ? 'opacity-60' : ''}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-1">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{insuranceName}</h3>
        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${cfg.className}`}>
          {cfg.icon && <TriangleAlert size={11} />}
          {statusLabelMap[displayStatus]}
        </span>
      </div>

      {coverageType && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">{coverageType}</p>
      )}

      <div className="grid grid-cols-2 gap-3 mb-3 text-xs">
        <div>
          <p className="text-gray-400 dark:text-gray-500 mb-0.5">{t('annualFeeLabel')}</p>
          <p className="font-medium text-gray-800 dark:text-gray-200">{fmt(annualPremium)}</p>
        </div>
        <div>
          <p className="text-gray-400 dark:text-gray-500 mb-0.5">{t('savedLabel')}</p>
          <p className="font-medium text-gray-800 dark:text-gray-200">{fmt(localAmountSaved)}</p>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between text-xs text-gray-400 dark:text-gray-500 mb-1">
          <span>{t('savingsProgressLabel')}</span>
          <span>{Math.round(localProgress)}%</span>
        </div>
        <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${isCompleted ? 'bg-gray-400 dark:bg-gray-500' : 'bg-indigo-500'}`}
            style={{ width: `${localProgress}%` }}
          />
        </div>
      </div>

      {nextPaymentDate && !isCompleted && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
          {t('nextPaymentLabel', { date: fmtDate(nextPaymentDate) })}
        </p>
      )}
      {lastPaymentDate && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
          {t('lastPaymentLabel', { date: fmtDate(lastPaymentDate) })}
        </p>
      )}

      {/* Toast */}
      {toast && (
        <p className={`text-xs mt-2 ${toast.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
          {toast.msg}
        </p>
      )}

      {/* Add Savings */}
      <div className="border-t border-gray-100 dark:border-gray-700 mt-3 pt-3">
        <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">{t('addSavingsLabel')}</p>
        <div className="flex gap-2">
          <input
            type="number"
            value={inputAmount}
            onChange={(e) => setInputAmount(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder={t('savingsAmountPlaceholder')}
            className="flex-1 min-w-0 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={handleAdd}
            disabled={isLoading}
            className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
          >
            {t('addBtn')}
          </button>
        </div>
      </div>

      {/* Savings Records */}
      {savingsList.length > 0 && (
        <div className="border-t border-gray-100 dark:border-gray-700 mt-3 pt-3">
          <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">{t('savingsHistoryLabel')}</p>
          <ul className="space-y-1.5">
            {savingsList.map((s) => (
              <li key={s.id} className="flex items-center justify-between">
                <span className="text-xs text-gray-700 dark:text-gray-300">{fmt(s.amount_saved_vnd)}</span>
                <button
                  onClick={() => handleDelete(s.id, s.amount_saved_vnd)}
                  disabled={isLoading}
                  className="text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-40 transition-colors"
                  aria-label="Delete"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Mark as Paid */}
      {showMarkAsPaid && (
        <div className="border-t border-gray-100 dark:border-gray-700 mt-3 pt-3">
          <button
            onClick={() => setShowConfirm(true)}
            className="w-full py-2 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 transition-colors"
          >
            {t('markPaidBtn')}
          </button>
        </div>
      )}

      {/* Confirmation Dialog */}
      {showConfirm && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowConfirm(false) }}
        >
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm p-6 border border-gray-100 dark:border-gray-700">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">{t('markPaidTitle')}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              {t('markPaidMessage', { name: insuranceName })}
            </p>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 mb-4 border-l-4 border-indigo-500">
              <p className="text-xs text-gray-700 dark:text-gray-300 font-medium">{insuranceName}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t('annualPayment', { amount: fmt(annualPremium) })}</p>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-5">{t('markPaidNote')}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                disabled={markPaidLoading}
                className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                {tc('cancel')}
              </button>
              <button
                onClick={handleMarkAsPaid}
                disabled={markPaidLoading}
                className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {markPaidLoading ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    {t('markPaidProcessing')}
                  </>
                ) : tc('confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
