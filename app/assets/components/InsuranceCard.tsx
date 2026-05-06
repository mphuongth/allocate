'use client'

import { useState, useEffect, useCallback } from 'react'
import { Shield, Trash2, Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { fmtCompact } from '@/lib/formatters'

const fmtDate = (dateStr: string): string => {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
  } catch { return '' }
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
  } catch { return 'not_due_yet' }
}

interface SavingsRecord { id: string; amount_saved_vnd: number; created_at: string }

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

export default function InsuranceCard({
  insuranceId, insuranceName, coverageType, annualPremium, amountSaved,
  savingsProgressPercentage, status, nextPaymentDate, lastPaymentDate, onSavingsChange,
}: Props) {
  const t = useTranslations('dashboard')
  const tc = useTranslations('common')

  const isCompleted = status === 'completed'
  const displayStatus: DisplayStatus | 'completed' = isCompleted ? 'completed' : computeDisplayStatus(nextPaymentDate)

  const statusColor: Record<DisplayStatus | 'completed', string> = {
    not_due_yet: 'var(--c-pos)',
    due:         'var(--c-warn)',
    overdue:     'var(--c-neg)',
    completed:   'var(--c-muted)',
  }
  const statusLabel: Record<DisplayStatus | 'completed', string> = {
    not_due_yet: t('statusNotDue'),
    due:         t('statusDue'),
    overdue:     t('statusOverdue'),
    completed:   t('statusCompleted'),
  }
  const barColor: Record<DisplayStatus | 'completed', string> = {
    not_due_yet: 'var(--c-pos)',
    due:         'var(--c-warn)',
    overdue:     'var(--c-neg)',
    completed:   'var(--c-muted)',
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
    if (!inputAmount || isNaN(amount) || amount <= 0) { showToast(t('savingsAmountRequired'), 'error'); return }
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

  const dotColor = statusColor[displayStatus]
  const bar = barColor[displayStatus]

  return (
    <div style={{
      background: 'var(--c-card)',
      border: '1px solid var(--c-line)',
      borderRadius: 'var(--r-card)',
      boxShadow: 'var(--shadow-card)',
      opacity: isCompleted ? 0.7 : 1,
    }}>
      {/* ── Compact header row (InsuranceMini pattern) ── */}
      <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8, flexShrink: 0,
          background: 'var(--c-card-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--c-accent-insurance)',
        }}>
          <Shield size={16} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-ink)' }}>{insuranceName}</span>
            {coverageType && <span style={{ fontSize: 11, color: 'var(--c-muted)' }}>· {coverageType}</span>}
          </div>
          <div style={{ marginTop: 5 }}>
            <div style={{ width: '100%', height: 4, background: 'var(--c-card-2)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 999, width: `${localProgress}%`, background: bar, transition: 'width 400ms ease' }} />
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: dotColor, display: 'inline-block' }} />
            <span style={{ fontSize: 10, fontWeight: 500, color: dotColor, letterSpacing: '0.02em' }}>
              {statusLabel[displayStatus]}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
            {fmtCompact(localAmountSaved)} / {fmtCompact(annualPremium)}
          </div>
        </div>
      </div>

      {/* ── Divider ── */}
      <div style={{ height: 1, background: 'var(--c-line)' }} />

      {/* ── Details + actions ── */}
      <div style={{ padding: '12px 14px', display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <span style={{ color: 'var(--c-muted)' }}>{t('annualFeeLabel')}</span>
          <span style={{ fontWeight: 500, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(annualPremium)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <span style={{ color: 'var(--c-muted)' }}>{t('monthlyFeeLabel')}</span>
          <span style={{ fontWeight: 500, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(monthlyFee)}</span>
        </div>

        {nextPaymentDate && !isCompleted && (
          <p style={{ fontSize: 11, color: 'var(--c-muted)', margin: 0 }}>
            {t('nextPaymentLabel', { date: fmtDate(nextPaymentDate) })}
          </p>
        )}
        {lastPaymentDate && (
          <p style={{ fontSize: 11, color: 'var(--c-muted-2)', margin: 0 }}>
            {t('lastPaymentLabel', { date: fmtDate(lastPaymentDate) })}
          </p>
        )}

        {toast && (
          <p style={{ fontSize: 12, margin: 0, color: toast.type === 'error' ? 'var(--c-neg)' : 'var(--c-pos)' }}>
            {toast.msg}
          </p>
        )}

        {/* Quick save input */}
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="number"
            value={inputAmount}
            onChange={(e) => setInputAmount(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder={t('savingsAmountPlaceholder')}
            style={{
              flex: 1, minWidth: 0,
              border: '1px solid var(--c-line)', borderRadius: 8,
              padding: '6px 10px', fontSize: 12,
              background: 'var(--c-card-2)', color: 'var(--c-ink)',
              fontFamily: 'inherit', outline: 'none',
            }}
          />
          <button
            onClick={handleAdd}
            disabled={isLoading}
            style={{
              width: 32, height: 32, flexShrink: 0,
              background: 'var(--c-navy)', color: '#fff',
              border: 'none', borderRadius: 8, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              opacity: isLoading ? 0.5 : 1,
            }}
            aria-label={t('addBtn')}
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Savings history */}
        {savingsList.length > 0 && (
          <div style={{ borderTop: '1px solid var(--c-line)', paddingTop: 8, display: 'grid', gap: 4 }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {t('savingsHistoryLabel')}
            </p>
            {savingsList.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtCompact(s.amount_saved_vnd)}
                </span>
                <button
                  onClick={() => handleDelete(s.id, s.amount_saved_vnd)}
                  disabled={isLoading}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--c-muted-2)', opacity: isLoading ? 0.4 : 1 }}
                  aria-label="Delete"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Mark as Paid */}
        {showMarkAsPaid && (
          <div style={{ borderTop: '1px solid var(--c-line)', paddingTop: 8 }}>
            <button
              onClick={() => setShowConfirm(true)}
              style={{
                width: '100%', padding: '8px 0',
                background: 'var(--c-navy)', color: '#fff',
                border: 'none', borderRadius: 8, cursor: 'pointer',
                fontSize: 12, fontWeight: 500, fontFamily: 'inherit',
              }}
            >
              {t('markPaidBtn')}
            </button>
          </div>
        )}
      </div>

      {/* ── Confirm dialog ── */}
      {showConfirm && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowConfirm(false) }}
        >
          <div style={{
            background: 'var(--c-card)', border: '1px solid var(--c-line)',
            borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-pop)',
            width: '100%', maxWidth: 360, padding: 24,
          }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 600 }}>{t('markPaidTitle')}</h3>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--c-muted)' }}>
              {t('markPaidMessage', { name: insuranceName })}
            </p>
            <div style={{ background: 'var(--c-navy-tint)', borderRadius: 10, padding: '10px 12px', marginBottom: 16, borderLeft: '3px solid var(--c-navy)' }}>
              <p style={{ margin: 0, fontSize: 12, fontWeight: 500 }}>{insuranceName}</p>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--c-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {t('annualPayment', { amount: fmtCompact(annualPremium) })}
              </p>
            </div>
            <p style={{ margin: '0 0 20px', fontSize: 11, color: 'var(--c-muted-2)' }}>{t('markPaidNote')}</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setShowConfirm(false)}
                disabled={markPaidLoading}
                style={{
                  flex: 1, padding: '8px 0',
                  background: 'transparent', border: '1px solid var(--c-line)',
                  borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', color: 'var(--c-ink)',
                }}
              >
                {tc('cancel')}
              </button>
              <button
                onClick={handleMarkAsPaid}
                disabled={markPaidLoading}
                style={{
                  flex: 2, padding: '8px 0',
                  background: 'var(--c-navy)', color: '#fff',
                  border: 'none', borderRadius: 8, cursor: 'pointer',
                  fontSize: 13, fontWeight: 500, fontFamily: 'inherit',
                  opacity: markPaidLoading ? 0.6 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                {markPaidLoading ? (
                  <>
                    <svg style={{ width: 14, height: 14 }} viewBox="0 0 24 24" fill="none" className="animate-spin">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
                      <path fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" opacity="0.75" />
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
