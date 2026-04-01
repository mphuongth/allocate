'use client'

import { useState, useEffect, useCallback } from 'react'
import { Wallet, Trash2, TriangleAlert } from 'lucide-react'
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

const STATUS_BADGE: Record<DisplayStatus | 'completed', { cls: string; icon?: boolean }> = {
  not_due_yet: { cls: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' },
  due:         { cls: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300' },
  overdue:     { cls: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300', icon: true },
  completed:   { cls: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400' },
}

export default function InsuranceCard({
  insuranceId, insuranceName, coverageType, annualPremium, amountSaved,
  savingsProgressPercentage, status, nextPaymentDate, lastPaymentDate, onSavingsChange,
}: Props) {
  const t = useTranslations('dashboard')
  const tc = useTranslations('common')

  const isCompleted = status === 'completed'
  const displayStatus: DisplayStatus | 'completed' = isCompleted ? 'completed' : computeDisplayStatus(nextPaymentDate)
  const badge = STATUS_BADGE[displayStatus]
  const statusLabel: Record<DisplayStatus | 'completed', string> = {
    not_due_yet: t('statusNotDue'),
    due:         t('statusDue'),
    overdue:     t('statusOverdue'),
    completed:   t('statusCompleted'),
  }
  const showMarkAsPaid = status === 'upcoming' || status === 'overdue'
  const monthlyFee = Math.round(annualPremium / 12)

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
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setShowConfirm(false) }
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
    <div className={`rounded-xl border shadow-sm p-5 transition-opacity ${
      isCompleted
        ? 'opacity-60 bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700'
        : 'bg-gradient-to-br from-violet-100 via-purple-50 to-purple-100 dark:from-violet-900/30 dark:via-purple-900/20 dark:to-purple-900/10 border-violet-300 dark:border-violet-700/60'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-full bg-violet-600 dark:bg-violet-500 flex items-center justify-center text-white font-semibold text-sm flex-shrink-0">
            {insuranceName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm truncate">{insuranceName}</h3>
            {coverageType && (
              <span className="inline-block mt-0.5 text-xs px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 font-medium">
                {coverageType}
              </span>
            )}
          </div>
        </div>
        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ml-2 ${badge.cls}`}>
          {badge.icon && <TriangleAlert size={10} />}
          {statusLabel[displayStatus]}
        </span>
      </div>

      {/* Annual / Monthly */}
      <div className="space-y-2 text-sm mb-3">
        <div className="flex items-center justify-between">
          <span className="text-gray-600 dark:text-gray-400">{t('annualFeeLabel')}:</span>
          <span className="font-medium text-gray-900 dark:text-gray-100">{fmt(annualPremium)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-600 dark:text-gray-400">{t('monthlyFeeLabel')}:</span>
          <span className="font-medium text-gray-900 dark:text-gray-100">{fmt(monthlyFee)}</span>
        </div>
      </div>

      {/* Savings progress */}
      <div className="border-t border-violet-200/60 dark:border-violet-700/40 pt-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-600 dark:text-gray-400">{t('savedLabel')}:</span>
          <span className="text-sm font-bold text-violet-700 dark:text-violet-400">{fmt(localAmountSaved)}</span>
        </div>
        <div className="h-2 bg-violet-200/70 dark:bg-violet-800/50 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${isCompleted ? 'bg-gray-400' : 'bg-violet-600'}`}
            style={{ width: `${localProgress}%` }}
          />
        </div>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          {Math.round(localProgress)}% {t('ofAnnualFee')}
        </p>
      </div>

      {/* Next payment date */}
      {nextPaymentDate && !isCompleted && (
        <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
          {t('nextPaymentLabel', { date: fmtDate(nextPaymentDate) })}
        </p>
      )}
      {lastPaymentDate && (
        <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">
          {t('lastPaymentLabel', { date: fmtDate(lastPaymentDate) })}
        </p>
      )}

      {/* Toast */}
      {toast && (
        <p className={`text-xs mt-2 ${toast.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
          {toast.msg}
        </p>
      )}

      {/* Quick save input */}
      <div className="border-t border-violet-200/60 dark:border-violet-700/40 mt-3 pt-3">
        <div className="flex gap-2">
          <input
            type="number"
            value={inputAmount}
            onChange={(e) => setInputAmount(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder={t('savingsAmountPlaceholder')}
            className="flex-1 min-w-0 border border-violet-300 dark:border-violet-700 rounded-lg px-3 py-1.5 text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
          <button
            onClick={handleAdd}
            disabled={isLoading}
            className="flex items-center justify-center h-8 w-8 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-lg hover:bg-gray-700 dark:hover:bg-gray-200 disabled:opacity-50 flex-shrink-0 transition-colors"
            title={t('addBtn')}
          >
            <Wallet className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Savings records */}
      {savingsList.length > 0 && (
        <div className="border-t border-violet-200/60 dark:border-violet-700/40 mt-3 pt-3">
          <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">{t('savingsHistoryLabel')}</p>
          <ul className="space-y-1">
            {savingsList.map((s) => (
              <li key={s.id} className="flex items-center justify-between">
                <span className="text-xs text-gray-700 dark:text-gray-300">{fmt(s.amount_saved_vnd)}</span>
                <button
                  onClick={() => handleDelete(s.id, s.amount_saved_vnd)}
                  disabled={isLoading}
                  className="text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400 disabled:opacity-40 transition-colors"
                  aria-label="Delete"
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Mark as Paid */}
      {showMarkAsPaid && (
        <div className="border-t border-violet-200/60 dark:border-violet-700/40 mt-3 pt-3">
          <button
            onClick={() => setShowConfirm(true)}
            className="w-full py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-xs font-medium rounded-lg hover:bg-gray-700 dark:hover:bg-gray-200 transition-colors"
          >
            {t('markPaidBtn')}
          </button>
        </div>
      )}

      {/* Confirmation dialog */}
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
            <div className="bg-violet-50 dark:bg-violet-900/20 rounded-lg p-3 mb-4 border-l-4 border-violet-500">
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
                className="flex-1 py-2 text-sm font-medium text-white bg-violet-600 rounded-lg hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-2"
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
