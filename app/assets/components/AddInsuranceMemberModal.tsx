'use client'

import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { fmtCompact } from '@/lib/formatters'

interface Props {
  open: boolean
  onClose: () => void
  onCreated?: () => void
  locale: string
}

const COVERAGE_OPTIONS: { value: string; label: string; labelVi: string }[] = [
  { value: 'Self', label: 'Self', labelVi: 'Bản thân' },
  { value: 'Spouse', label: 'Spouse', labelVi: 'Vợ/Chồng' },
  { value: 'Child', label: 'Child', labelVi: 'Con' },
]

export default function AddInsuranceMemberModal({ open, onClose, onCreated, locale }: Props) {
  const isVi = locale === 'vi'
  const [name, setName] = useState('')
  const [coverage, setCoverage] = useState('Self')
  const [premium, setPremium] = useState<number>(12_000_000)
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset form when reopened
  useEffect(() => {
    if (open) {
      setName('')
      setCoverage('Self')
      setPremium(12_000_000)
      setStartDate(new Date().toISOString().slice(0, 10))
      setSubmitting(false)
      setError(null)
    }
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const monthly = (premium || 0) / 12
  const canSubmit = name.trim().length > 0 && premium > 0 && !submitting

  const t = isVi
    ? { title: 'Thêm thành viên BH', name: 'Họ tên', namePh: 'VD. Linh Nguyễn',
        coverage: 'Mối quan hệ', premium: 'Phí bảo hiểm năm (₫)',
        start: 'Ngày bắt đầu', monthly: 'Đóng góp hàng tháng',
        save: 'Thêm thành viên', cancel: 'Hủy' }
    : { title: 'Add insurance member', name: 'Full name', namePh: 'e.g. Linh Nguyen',
        coverage: 'Coverage type', premium: 'Annual premium (₫)',
        start: 'Start date', monthly: 'Monthly contribution',
        save: 'Add member', cancel: 'Cancel' }

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/insurance-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member_name: name.trim(),
          relationship: coverage,
          annual_payment_vnd: premium,
          payment_date: startDate || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error || (isVi ? 'Không thể tạo thành viên' : 'Failed to create member'))
      }
      onCreated?.()
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setSubmitting(false)
    }
  }

  return (
    <div
      data-testid="add-insurance-modal"
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
          width: '100%', maxWidth: 440,
          maxHeight: 'calc(100vh - 48px)',
          background: 'var(--c-card)', borderRadius: 16,
          boxShadow: '0 24px 48px rgba(15,23,42,0.18), 0 8px 16px rgba(15,23,42,0.08)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* Header */}
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

        {/* Body */}
        <div style={{ padding: '18px 20px', overflowY: 'auto' }}>
          <div style={{ display: 'grid', gap: 14 }}>
            {/* Name */}
            <FormField label={t.name}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.namePh}
                autoFocus
                className="cn-input"
              />
            </FormField>

            {/* Coverage */}
            <FormField label={t.coverage}>
              <div style={{ display: 'flex', gap: 8 }}>
                {COVERAGE_OPTIONS.map((o) => {
                  const active = coverage === o.value
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => setCoverage(o.value)}
                      style={{
                        flex: 1, padding: 8, borderRadius: 8, fontSize: 12, fontWeight: 600,
                        background: active ? 'var(--c-btn-primary)' : 'var(--c-card-2)',
                        color: active ? '#fff' : 'var(--c-muted)',
                        border: `1px solid ${active ? 'var(--c-btn-primary)' : 'var(--c-line)'}`,
                        cursor: 'pointer', fontFamily: 'inherit', transition: 'all 120ms',
                      }}
                    >
                      {isVi ? o.labelVi : o.label}
                    </button>
                  )
                })}
              </div>
            </FormField>

            {/* Premium */}
            <FormField label={t.premium}>
              <input
                type="text"
                inputMode="numeric"
                value={premium ? Number(premium).toLocaleString('en-US') : ''}
                onChange={(e) => setPremium(Number(e.target.value.replace(/,/g, '').replace(/[^0-9]/g, '')))}
                className="cn-input"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              />
            </FormField>

            {/* Monthly preview */}
            <div style={{
              background: 'var(--c-navy-tint)', borderRadius: 10, padding: '12px 16px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{
                fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
                textTransform: 'uppercase', color: 'var(--c-navy)',
              }}>
                {t.monthly}
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--c-navy)', fontVariantNumeric: 'tabular-nums' }}>
                {fmtCompact(monthly)}
              </div>
            </div>

            {/* Start date */}
            <FormField label={t.start}>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="cn-input"
              />
            </FormField>

            {error && (
              <div role="alert" style={{ fontSize: 12, color: 'var(--c-neg)' }}>
                {error}
              </div>
            )}

            {/* Footer buttons */}
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
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="cn-btn primary"
                style={{ flex: 2, justifyContent: 'center', gap: 6, opacity: canSubmit ? 1 : 0.6 }}
              >
                <Plus size={14} strokeWidth={2.4} />
                {t.save}
              </button>
            </div>
          </div>
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
