'use client'

import { useEffect, useState } from 'react'
import { Check, Shield, X } from 'lucide-react'
import { fmtCompact } from '@/lib/formatters'
import type { InsuranceData } from '../DashboardClient'

interface Props {
  open: boolean
  onClose: () => void
  onSaved?: () => void
  ins: InsuranceData | null
  locale: string
}

export default function LogInsurancePaymentModal({ open, onClose, onSaved, ins, locale }: Props) {
  const isVi = locale === 'vi'
  const suggested = ins ? Math.round(ins.annualPremium / 12) : 0
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setAmount('')
      setSubmitting(false)
      setDone(false)
      setError(null)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !ins) return null

  const amountNum = Number(amount)
  const canSubmit = amountNum > 0 && !submitting

  const t = isVi
    ? { title: 'Ghi nhận thanh toán', amount: 'Số tiền (₫)',
        suggest: 'Gợi ý', cancel: 'Hủy', save: 'Xác nhận', doneMsg: 'Đã ghi nhận!' }
    : { title: 'Log payment', amount: 'Amount (₫)',
        suggest: 'Suggested', cancel: 'Cancel', save: 'Confirm', doneMsg: 'Payment logged!' }

  async function handleSave() {
    if (!canSubmit || !ins) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/insurance-savings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          insurance_member_id: ins.insuranceId,
          amount_saved_vnd: amountNum,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error || (isVi ? 'Không thể ghi nhận' : 'Failed to log payment'))
      }
      setDone(true)
      onSaved?.()
      setTimeout(() => onClose(), 1400)
    } catch (e) {
      setError((e as Error).message)
      setSubmitting(false)
    }
  }

  return (
    <div
      data-testid="log-payment-modal"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)',
        zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t.title}
        style={{
          width: '100%', maxWidth: 400,
          maxHeight: 'calc(100vh - 48px)',
          background: 'var(--c-card)', borderRadius: 16,
          boxShadow: '0 24px 48px rgba(15,23,42,0.18), 0 8px 16px rgba(15,23,42,0.08)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 20px 14px', borderBottom: '1px solid var(--c-line)', flexShrink: 0,
        }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>{t.title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={isVi ? 'Đóng' : 'Close'}
            className="cn-btn ghost"
            style={{ padding: 6 }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '18px 20px', overflowY: 'auto' }}>
          {done ? (
            <div style={{ padding: '28px 0', textAlign: 'center' }}>
              <div style={{
                width: 52, height: 52, borderRadius: 26,
                background: 'var(--c-pos-tint)', color: 'var(--c-pos)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 12px',
              }}>
                <Check size={26} strokeWidth={2.5} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{t.doneMsg}</div>
              <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 4 }}>{ins.insuranceName}</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              {/* Member chip */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px', background: 'var(--c-card-2)', borderRadius: 10,
              }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 9,
                  background: 'var(--c-card)', color: 'var(--c-accent-insurance)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, border: '1px solid var(--c-line)',
                }}>
                  <Shield size={15} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ins.insuranceName}</div>
                  {ins.coverageType && (
                    <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 1 }}>{ins.coverageType}</div>
                  )}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtCompact(ins.annualPremium)}/yr
                </div>
              </div>

              <FormField label={t.amount}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '10px 12px', background: 'var(--c-card)',
                    border: '1.5px solid var(--c-btn-primary)', borderRadius: 10,
                  }}>
                    <span style={{ fontSize: 14, color: 'var(--c-muted)' }}>₫</span>
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder={suggested ? suggested.toLocaleString('vi-VN') : ''}
                      autoFocus
                      style={{
                        flex: 1, minWidth: 0, border: 'none', outline: 'none',
                        fontSize: 15, fontWeight: 600, fontFamily: 'inherit',
                        background: 'transparent', color: 'var(--c-ink)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setAmount(String(suggested))}
                    style={{
                      padding: '8px 12px', background: 'var(--c-navy-tint)',
                      color: 'var(--c-navy)', border: '1px solid var(--c-navy-tint)',
                      borderRadius: 10, fontSize: 11, fontWeight: 600,
                      cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0,
                    }}
                  >
                    {t.suggest}
                  </button>
                </div>
              </FormField>

              {error && (
                <div role="alert" style={{ fontSize: 12, color: 'var(--c-neg)' }}>
                  {error}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  onClick={onClose}
                  className="cn-btn ghost"
                  style={{ flex: 1, justifyContent: 'center', border: '1px solid var(--c-line)' }}
                >
                  {t.cancel}
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!canSubmit}
                  className="cn-btn primary"
                  style={{ flex: 2, justifyContent: 'center', gap: 6, opacity: canSubmit ? 1 : 0.6 }}
                >
                  <Check size={14} strokeWidth={2.4} />
                  {t.save}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <label style={{
        fontSize: 11, fontWeight: 600, letterSpacing: '0.05em',
        textTransform: 'uppercase', color: 'var(--c-muted)',
      }}>
        {label}
      </label>
      {children}
    </div>
  )
}
