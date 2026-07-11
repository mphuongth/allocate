'use client'

import { useState, useEffect, useRef } from 'react'
import { Check, Download, X } from 'lucide-react'
import { iconHit } from './iconHit'
import { useLocale } from 'next-intl'
import { fmt } from '@/lib/formatters'
import { CairnLoader } from '@/app/components/ui/CairnLoader'
import { useDialogA11y } from '@/app/(app)/planning/components/useDialogA11y'

interface Props {
  open: boolean
  onClose: () => void
  data: { netWorth: number; currentValue: number; totalPL: number; goalCount: number } | null
  onExport: () => Promise<void>
  desktop?: boolean
}

export default function DownloadReportSheet({ open, onClose, data, onExport, desktop }: Props) {
  const isVI = useLocale() === 'vi'
  const [mounted, setMounted] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  // Esc-to-close, focus-trap and focus-restore — same hook the Plan page dialogs
  // use. Active while the panel is on screen (the mobile variant lingers one
  // close-animation past `open`, the desktop variant unmounts immediately).
  useDialogA11y(dialogRef, desktop ? open : (open && mounted), onClose)

  useEffect(() => {
    if (open) {
      setMounted(true)
      setSuccess(false)
      setExporting(false)
      setError('')
    } else {
      const t = setTimeout(() => setMounted(false), 220)
      return () => clearTimeout(t)
    }
  }, [open])

  async function handleExport() {
    setExporting(true)
    setError('')
    try {
      await onExport()
      setSuccess(true)
      setTimeout(() => { onClose() }, 2000)
    } catch {
      setError(isVI ? 'Không thể xuất báo cáo. Vui lòng thử lại.' : 'Couldn’t export the report. Please try again.')
    }
    setExporting(false)
  }

  if (desktop ? !open : !mounted) return null

  const today = new Date().toLocaleDateString(isVI ? 'vi-VN' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  const t = isVI ? {
    title: 'Báo cáo danh mục',
    asOf: 'Tính đến',
    netWorth: 'Tài sản ròng',
    currentVal: 'Giá trị hiện tại',
    pl: 'Lãi / Lỗ tổng',
    goals: 'Mục tiêu đang theo dõi',
    sections: 'Nội dung báo cáo',
    includes: ['Tổng quan tài sản ròng', 'Chi tiết từng mục tiêu', 'Phân bổ theo loại tài sản', 'Khoản chưa phân bổ', 'Lịch sử giao dịch'],
    export: 'Xuất báo cáo',
    exporting: 'Đang xuất',
    cancel: 'Hủy',
    close: 'Đóng',
    done: 'Đã xuất báo cáo',
    doneSub: 'Kiểm tra thư mục tải xuống của bạn',
  } : {
    title: 'Portfolio report',
    asOf: 'As of',
    netWorth: 'Net worth',
    currentVal: 'Current value',
    pl: 'Total P/L',
    goals: 'Goals tracked',
    sections: 'Report includes',
    includes: ['Net worth overview', 'Per-goal breakdown', 'Asset type allocation', 'Unallocated holdings', 'Transaction history'],
    export: 'Export report',
    exporting: 'Exporting',
    cancel: 'Cancel',
    close: 'Close',
    done: 'Report exported',
    doneSub: 'Check your downloads folder',
  }

  const isPos = !data || data.totalPL >= 0

  const body = success ? (
            <div data-testid="export-success" style={{ padding: '28px 0', textAlign: 'center' }}>
              <div style={{
                width: 56, height: 56, borderRadius: 28,
                background: 'var(--c-pos-tint)', color: 'var(--c-pos)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px',
              }}>
                <Check size={28} strokeWidth={2.5} />
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-ink)' }}>{t.done}</div>
              <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 4 }}>{t.doneSub}</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              {/* Date */}
              <div style={{ fontSize: 12, color: 'var(--c-muted)' }}>
                {t.asOf}{' '}
                <span style={{ fontWeight: 600, color: 'var(--c-ink)' }}>{today}</span>
              </div>

              {/* KPI grid — skeleton until the overview resolves, so the sheet
                  shows a stable placeholder instead of an empty gap. */}
              {data ? (
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: 1, background: 'var(--c-line)', borderRadius: 12, overflow: 'hidden',
                }}>
                  {[
                    { label: t.netWorth,   value: fmt(data.netWorth) },
                    { label: t.currentVal, value: fmt(data.currentValue) },
                    { label: t.pl,         value: (isPos ? '+' : '') + fmt(data.totalPL), color: isPos ? 'var(--c-pos)' : 'var(--c-neg)' },
                    { label: t.goals,      value: String(data.goalCount) },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ background: 'var(--c-card)', padding: '10px 12px' }}>
                      <div style={{ fontSize: 10, color: 'var(--c-muted)' }}>{label}</div>
                      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2, color: color ?? 'var(--c-ink)' }}>{value}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  data-testid="report-kpi-loading"
                  aria-busy="true"
                  aria-label={isVI ? 'Đang tải số liệu' : 'Loading figures'}
                  style={{
                    display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: 1, background: 'var(--c-line)', borderRadius: 12, overflow: 'hidden',
                  }}
                >
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} style={{ background: 'var(--c-card)', padding: '10px 12px' }}>
                      <div style={{ height: 8, width: '45%', borderRadius: 4, background: 'var(--c-line)' }} />
                      <div style={{ height: 12, width: '70%', borderRadius: 4, background: 'var(--c-line)', marginTop: 6 }} />
                    </div>
                  ))}
                </div>
              )}

              {/* What's included */}
              <div>
                <div style={{ fontSize: 11, color: 'var(--c-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                  {t.sections}
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {t.includes.map((item) => (
                    <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        width: 18, height: 18, borderRadius: 9,
                        background: 'var(--c-pos-tint)', color: 'var(--c-pos)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        <Check size={11} strokeWidth={2.5} />
                      </div>
                      <span style={{ fontSize: 13, color: 'var(--c-ink)' }}>{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Export error */}
              {error && (
                <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--c-neg, #dc2626)', textAlign: 'center' }}>{error}</p>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  onClick={onClose}
                  aria-label={t.cancel}
                  style={{
                    flex: 1, padding: '11px 0', fontSize: 13, fontWeight: 500,
                    minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'var(--c-card)', border: '1px solid var(--c-line)',
                    borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
                    color: 'var(--c-ink)',
                  }}
                >
                  {t.cancel}
                </button>
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  data-testid="export-report-btn"
                  aria-label={exporting ? t.exporting : t.export}
                  style={{
                    flex: 2, padding: '11px 0', fontSize: 13, fontWeight: 600,
                    minHeight: 44,
                    background: 'var(--c-btn-primary)', border: 'none',
                    borderRadius: 10, color: '#fff',
                    cursor: exporting ? 'default' : 'pointer',
                    opacity: exporting ? 0.7 : 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    fontFamily: 'inherit', transition: 'opacity 150ms',
                  }}
                >
                  {exporting ? (
                    <CairnLoader size={14} variant="on-dark" />
                  ) : (
                    <Download size={14} strokeWidth={2.2} />
                  )}
                  {exporting
                    ? (isVI ? 'Đang xuất…' : 'Exporting…')
                    : t.export}
                </button>
              </div>
            </div>
          )

  if (desktop) {
    return (
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', zIndex: 200,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          animation: 'fade-in 150ms ease', backdropFilter: 'blur(2px)',
        }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t.title}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          style={{
            width: '100%', maxWidth: 460, maxHeight: 'calc(100vh - 48px)',
            background: 'var(--c-card)', borderRadius: 16,
            boxShadow: '0 24px 48px rgba(15,23,42,0.18), 0 8px 16px rgba(15,23,42,0.08)',
            display: 'flex', flexDirection: 'column',
            animation: 'modal-in 200ms cubic-bezier(0.2,0.8,0.2,1)', overflow: 'hidden', outline: 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px 14px', borderBottom: '1px solid var(--c-line)', flexShrink: 0 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>{t.title}</h3>
            <button onClick={onClose} aria-label={t.close} style={{ ...iconHit, border: 'none', background: 'transparent', borderRadius: 8, cursor: 'pointer', color: 'var(--c-muted)' }}><X size={18} /></button>
          </div>
          <div style={{ flex: 1, padding: '18px 20px', overflowY: 'auto' }}>
            {body}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.2)',
        zIndex: 100, pointerEvents: open ? 'auto' : 'none',
      }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t.title}
        tabIndex={-1}
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'var(--c-card)', borderRadius: '16px 16px 0 0',
          padding: '0 0 env(safe-area-inset-bottom,0)',
          animation: open
            ? 'slide-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1)'
            : 'slide-down 180ms ease forwards',
          outline: 'none',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 36, height: 4, background: 'var(--c-line-strong)', borderRadius: 999, margin: '6px auto 14px' }} />

        <div style={{ padding: '0 16px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: 'var(--c-ink)' }}>{t.title}</h3>
            <button
              onClick={onClose}
              aria-label={t.close}
              style={{
                ...iconHit, background: 'transparent', border: 'none',
                cursor: 'pointer', color: 'var(--c-muted)', borderRadius: 8,
              }}
            >
              <X size={18} />
            </button>
          </div>
          {body}
        </div>
      </div>
    </div>
  )
}
