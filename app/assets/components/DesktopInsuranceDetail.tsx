'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronLeft, Edit2, Plus, Trash2, Calendar, X } from 'lucide-react'
import { fmt, fmtCompact } from '@/lib/formatters'
import type { InsuranceData } from '../DashboardClient'
import LogInsurancePaymentModal from './LogInsurancePaymentModal'

interface Props {
  ins: InsuranceData
  locale: string
  onClose: () => void
  onChanged?: () => void
}

const STATUS_COLOR: Record<string, string> = {
  on_track: 'var(--c-warn)',
  upcoming: 'var(--c-muted)',
  overdue: 'var(--c-neg)',
  completed: 'var(--c-pos)',
  ready: 'var(--c-navy)',
}

const BAR_COLOR: Record<string, string> = {
  on_track: 'var(--c-warn)',
  upcoming: 'var(--c-warn)',
  overdue: 'var(--c-neg)',
  completed: 'var(--c-pos)',
  ready: 'var(--c-navy)',
}

const COVERAGE_OPTIONS: { value: string; label: string; labelVi: string }[] = [
  { value: 'Self', label: 'Self', labelVi: 'Bản thân' },
  { value: 'Spouse', label: 'Spouse', labelVi: 'Vợ/Chồng' },
  { value: 'Child', label: 'Child', labelVi: 'Con' },
]

interface HistoryEntry {
  id: string
  amount: number
  date: string          // YYYY-MM-DD
  kind: 'logged' | 'plan'
}

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '·'
}

export default function DesktopInsuranceDetail({ ins, locale, onClose, onChanged }: Props) {
  const isVi = locale === 'vi'
  const progress = Math.min(ins.savingsProgressPercentage, 100)
  const barColor = BAR_COLOR[ins.status] ?? 'var(--c-warn)'
  const dotColor = STATUS_COLOR[ins.status] ?? 'var(--c-muted)'

  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(ins.insuranceName)
  const [editCoverage, setEditCoverage] = useState(ins.coverageType ?? 'Self')
  const [editPremium, setEditPremium] = useState<number>(ins.annualPremium)
  const [editDate, setEditDate] = useState(ins.nextPaymentDate ?? '')
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const [showLogPayment, setShowLogPayment] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [history, setHistory] = useState<HistoryEntry[] | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  // Sync edit form when target member changes
  useEffect(() => {
    setEditing(false)
    setEditName(ins.insuranceName)
    setEditCoverage(ins.coverageType ?? 'Self')
    setEditPremium(ins.annualPremium)
    setEditDate(ins.nextPaymentDate ?? '')
    setEditError(null)
  }, [ins.insuranceId, ins.insuranceName, ins.coverageType, ins.annualPremium, ins.nextPaymentDate])

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const res = await fetch(`/api/v1/insurance-members/${ins.insuranceId}/savings`)
      if (res.ok) {
        const j = await res.json()
        setHistory(j.entries ?? [])
      } else {
        setHistory([])
      }
    } catch {
      setHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }, [ins.insuranceId])

  useEffect(() => { loadHistory() }, [loadHistory])

  function statusLabel(s: string) {
    return isVi
      ? ({ on_track: 'Sắp đến hạn', completed: 'Đã thanh toán', overdue: 'Quá hạn', upcoming: 'Chưa đến hạn', ready: 'Đã tích lũy đủ' } as Record<string, string>)[s] ?? s
      : ({ on_track: 'Due soon', completed: 'Paid', overdue: 'Overdue', upcoming: 'Not due', ready: 'Ready to pay' } as Record<string, string>)[s] ?? s
  }

  // Status-aware CTA
  // - overdue → "Pay now" (red) → open LogPayment
  // - on_track → "Mark as paid" (navy) → call mark-paid
  // - ready → "Confirm payment sent" (navy) → call mark-paid
  // - other → "Log payment" (default) → open LogPayment
  const showStatusCta = ['overdue', 'on_track', 'ready'].includes(ins.status)
  const ctaLabel = isVi
    ? ({ overdue: 'Thanh toán ngay', on_track: 'Đánh dấu đã thanh toán', ready: 'Xác nhận đã thanh toán' } as Record<string, string>)[ins.status]
    : ({ overdue: 'Pay now', on_track: 'Mark as paid', ready: 'Confirm payment sent' } as Record<string, string>)[ins.status]
  const ctaBg = ins.status === 'overdue' ? 'var(--c-neg)' : 'var(--c-btn-primary)'

  async function handleStatusCta() {
    if (ins.status === 'overdue') {
      setShowLogPayment(true)
      return
    }
    // on_track / ready → mark current cycle as paid (advances payment_date)
    try {
      const res = await fetch(`/api/v1/insurance-members/${ins.insuranceId}/mark-paid`, { method: 'POST' })
      if (res.ok) {
        onChanged?.()
      }
    } catch {
      // ignore — silent failure surface; status reload via parent
    }
  }

  async function handleSaveEdit() {
    if (!editName.trim() || editPremium <= 0) return
    setSaving(true)
    setEditError(null)
    try {
      const res = await fetch(`/api/v1/insurance-members/${ins.insuranceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member_name: editName.trim(),
          relationship: editCoverage,
          annual_payment_vnd: editPremium,
          payment_date: editDate || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error || (isVi ? 'Không thể cập nhật' : 'Update failed'))
      }
      setEditing(false)
      onChanged?.()
    } catch (e) {
      setEditError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/v1/insurance-members/${ins.insuranceId}`, { method: 'DELETE' })
      if (res.ok) {
        setShowDeleteConfirm(false)
        onChanged?.()
        onClose()
      }
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div data-testid="insurance-detail-panel" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Back + Edit toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          onClick={onClose}
          className="cn-btn ghost"
          style={{ padding: '6px 0', gap: 4, fontSize: 12, color: 'var(--c-muted)' }}
        >
          <ChevronLeft size={14} />
          {isVi ? 'Quay lại' : 'Back'}
        </button>
        {!editing && (
          <button
            data-testid="insurance-edit-btn"
            onClick={() => setEditing(true)}
            aria-label={isVi ? 'Chỉnh sửa' : 'Edit'}
            className="cn-btn ghost"
            style={{ padding: 6 }}
          >
            <Edit2 size={14} color="var(--c-muted)" />
          </button>
        )}
      </div>

      {editing ? (
        <div className="cn-card" style={{ padding: 16, display: 'grid', gap: 14 }}>
          <Field label={isVi ? 'Họ tên' : 'Full name'}>
            <input value={editName} onChange={(e) => setEditName(e.target.value)} className="cn-input" autoFocus />
          </Field>
          <Field label={isVi ? 'Mối quan hệ' : 'Coverage type'}>
            <div style={{ display: 'flex', gap: 8 }}>
              {COVERAGE_OPTIONS.map((o) => {
                const active = editCoverage === o.value
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setEditCoverage(o.value)}
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
          </Field>
          <Field label={isVi ? 'Phí bảo hiểm năm (₫)' : 'Annual premium (₫)'}>
            <input
              type="text"
              inputMode="numeric"
              value={editPremium ? Number(editPremium).toLocaleString('en-US') : ''}
              onChange={(e) => setEditPremium(Number(e.target.value.replace(/,/g, '').replace(/[^0-9]/g, '')))}
              className="cn-input"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            />
            <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 4 }}>
              {fmtCompact(editPremium / 12)} / {isVi ? 'tháng' : 'month'}
            </div>
          </Field>
          <Field label={isVi ? 'Ngày bắt đầu' : 'Start date'}>
            <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} className="cn-input" />
          </Field>
          {editError && <div role="alert" style={{ fontSize: 12, color: 'var(--c-neg)' }}>{editError}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setEditing(false)} className="cn-btn ghost" style={{ flex: 1, justifyContent: 'center', border: '1px solid var(--c-line)' }}>
              {isVi ? 'Hủy' : 'Cancel'}
            </button>
            <button onClick={handleSaveEdit} disabled={saving || !editName.trim() || editPremium <= 0} className="cn-btn primary" style={{ flex: 2, justifyContent: 'center', opacity: saving ? 0.6 : 1 }}>
              {isVi ? 'Lưu' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="cn-card" style={{ padding: 16 }}>
            {/* Avatar + name */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <div
                data-testid="insurance-avatar"
                style={{
                  width: 42, height: 42, borderRadius: 21,
                  background: 'var(--c-btn-primary)', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700, flexShrink: 0,
                  letterSpacing: '0.02em',
                }}
              >
                {initialsFor(ins.insuranceName)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ins.insuranceName}
                </div>
                {ins.coverageType && (
                  <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 1 }}>{ins.coverageType}</div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: dotColor }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: dotColor }}>{statusLabel(ins.status)}</span>
              </div>
            </div>

            {/* Progress */}
            <div style={{ width: '100%', height: 6, background: 'var(--c-card-2)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: barColor, borderRadius: 999, transition: 'width 400ms ease' }} />
            </div>

            {/* KPIs — Annual / Saved / Progress / Monthly */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1, marginTop: 12, background: 'var(--c-line)', borderRadius: 8, overflow: 'hidden' }}>
              {[
                { l: isVi ? 'Phí hàng năm' : 'Annual premium', v: fmtCompact(ins.annualPremium) },
                { l: isVi ? 'Đã tích lũy' : 'Saved', v: fmtCompact(ins.amountSaved) },
                { l: isVi ? 'Tiến độ' : 'Progress', v: `${ins.savingsProgressPercentage.toFixed(1)}%` },
                { l: isVi ? 'Hàng tháng' : 'Monthly', v: fmtCompact(ins.annualPremium / 12) },
              ].map((k, i) => (
                <div key={i} style={{ background: 'var(--c-card)', padding: '9px 12px' }}>
                  <div style={{ fontSize: 10, color: 'var(--c-muted)' }}>{k.l}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{k.v}</div>
                </div>
              ))}
            </div>

            {/* Ready info note */}
            {ins.status === 'ready' && (
              <div style={{
                display: 'flex', gap: 8, alignItems: 'flex-start',
                padding: '10px 12px', background: 'var(--c-navy-tint)',
                borderRadius: 10, marginTop: 12, border: '1px solid rgba(15,42,74,0.08)',
              }}>
                <Calendar size={13} color="var(--c-navy)" />
                <p style={{ margin: 0, fontSize: 11, color: 'var(--c-navy)', lineHeight: 1.5 }}>
                  {isVi
                    ? 'Bạn đã tích lũy đủ số tiền. Xác nhận khi đã chuyển phí cho công ty bảo hiểm.'
                    : "You've saved the full amount. Confirm once you've sent the payment to your insurer."}
                </p>
              </div>
            )}

            {/* Status-aware CTA */}
            {showStatusCta ? (
              <button
                data-testid="insurance-cta-status"
                onClick={handleStatusCta}
                style={{
                  width: '100%', justifyContent: 'center', marginTop: 12, gap: 6, fontSize: 12,
                  padding: 10, background: ctaBg, color: '#fff', border: 'none',
                  borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                  display: 'flex', alignItems: 'center', transition: 'opacity 120ms',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = '0.85' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
              >
                <Check size={13} strokeWidth={2.4} />
                {ctaLabel}
              </button>
            ) : (
              <button
                data-testid="insurance-cta-log"
                onClick={() => setShowLogPayment(true)}
                className="cn-btn"
                style={{ width: '100%', justifyContent: 'center', marginTop: 12, gap: 6, fontSize: 12 }}
              >
                <Plus size={13} strokeWidth={2.4} />
                {isVi ? 'Ghi nhận thanh toán' : 'Log payment'}
              </button>
            )}
          </div>

          {/* Payment history */}
          <div className="cn-card" data-testid="insurance-payment-history" style={{ overflow: 'hidden' }}>
            <div style={{
              padding: '12px 16px', borderBottom: '1px solid var(--c-line)',
              fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
              textTransform: 'uppercase', color: 'var(--c-muted)',
            }}>
              {isVi ? 'Lịch sử thanh toán' : 'Payment history'}
            </div>
            {historyLoading && history === null ? (
              <div style={{ padding: '14px 16px', fontSize: 12, color: 'var(--c-muted)' }}>…</div>
            ) : !history || history.length === 0 ? (
              <div style={{ padding: '14px 16px', fontSize: 12, color: 'var(--c-muted)' }}>
                {isVi ? 'Chưa có giao dịch' : 'No payments yet'}
              </div>
            ) : (
              <>
                {history.map((p) => {
                  // Parse the plain date as a local date so it never shifts across timezones.
                  const [yy, mm, dd] = p.date.split('-').map(Number)
                  const dt = new Date(yy, (mm ?? 1) - 1, dd ?? 1)
                  const isPlan = p.kind === 'plan'
                  const dateStr = isPlan
                    ? dt.toLocaleDateString(isVi ? 'vi-VN' : 'en-GB', { month: 'short', year: 'numeric' })
                    : dt.toLocaleDateString(isVi ? 'vi-VN' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                  const sub = isPlan
                    ? (isVi ? 'Kế hoạch hàng tháng' : 'Monthly plan')
                    : (isVi ? 'Đã ghi nhận' : 'Logged payment')
                  return (
                    <div key={p.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '11px 16px',
                      borderBottom: '1px solid var(--c-line)',
                    }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: 7,
                        background: isPlan ? 'var(--c-navy-tint)' : 'var(--c-pos-tint)',
                        color: isPlan ? 'var(--c-navy)' : 'var(--c-pos)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        {isPlan ? <Calendar size={12} strokeWidth={2.2} /> : <Check size={12} strokeWidth={2.5} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 500 }}>{dateStr}</div>
                        <div style={{ fontSize: 10, color: 'var(--c-muted)', marginTop: 1 }}>{sub}</div>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>
                        {fmt(p.amount)}
                      </span>
                    </div>
                  )
                })}
                {/* Total — reconciles with the "Saved" KPI above */}
                <div data-testid="insurance-history-total" style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '11px 16px', background: 'var(--c-card-2)',
                }}>
                  <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--c-muted)' }}>
                    {isVi ? 'Tổng đã tích lũy' : 'Total saved'}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(history.reduce((s, e) => s + e.amount, 0))}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Remove member */}
          <button
            data-testid="insurance-remove-btn"
            onClick={() => setShowDeleteConfirm(true)}
            style={{
              width: '100%', padding: 11, background: 'transparent',
              border: '1px solid var(--c-line)', borderRadius: 10,
              color: 'var(--c-neg)', fontSize: 12, fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              cursor: 'pointer', fontFamily: 'inherit', transition: 'background 120ms',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--c-neg-tint)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            <Trash2 size={14} color="var(--c-neg)" />
            {isVi ? 'Xóa thành viên' : 'Remove member'}
          </button>
        </>
      )}

      <LogInsurancePaymentModal
        open={showLogPayment}
        onClose={() => setShowLogPayment(false)}
        onSaved={() => { onChanged?.(); loadHistory() }}
        ins={ins}
        locale={locale}
      />

      {showDeleteConfirm && (
        <div
          onClick={() => !deleting && setShowDeleteConfirm(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)',
            zIndex: 210, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24, backdropFilter: 'blur(2px)',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={isVi ? 'Xóa thành viên?' : 'Remove member?'}
            style={{
              width: '100%', maxWidth: 380, background: 'var(--c-card)',
              borderRadius: 16, padding: 20,
              boxShadow: '0 24px 48px rgba(15,23,42,0.18), 0 8px 16px rgba(15,23,42,0.08)',
              display: 'flex', flexDirection: 'column', gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
                {isVi ? 'Xóa thành viên?' : 'Remove member?'}
              </h3>
              <button
                onClick={() => !deleting && setShowDeleteConfirm(false)}
                aria-label={isVi ? 'Đóng' : 'Close'}
                className="cn-btn ghost"
                style={{ padding: 6 }}
              >
                <X size={16} />
              </button>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--c-muted)', lineHeight: 1.5 }}>
              {isVi
                ? `Bạn có chắc muốn xóa ${ins.insuranceName}? Mọi lịch sử thanh toán sẽ bị mất.`
                : `Are you sure you want to remove ${ins.insuranceName}? All payment history will be lost.`}
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="cn-btn ghost"
                style={{ flex: 1, justifyContent: 'center', border: '1px solid var(--c-line)' }}
              >
                {isVi ? 'Hủy' : 'Cancel'}
              </button>
              <button
                data-testid="insurance-remove-confirm"
                onClick={handleDelete}
                disabled={deleting}
                style={{
                  flex: 2, padding: '10px 0', fontSize: 13, fontWeight: 600,
                  background: 'var(--c-neg)', color: '#fff', border: 'none',
                  borderRadius: 10, cursor: deleting ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', opacity: deleting ? 0.6 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                }}
              >
                <Trash2 size={14} />
                {isVi ? 'Xóa' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
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
