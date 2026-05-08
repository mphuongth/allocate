'use client'

import { useState, useEffect } from 'react'
import { Check } from 'lucide-react'
import { useLocale } from 'next-intl'
import { fmt } from '@/lib/formatters'

interface Props {
  open: boolean
  onClose: () => void
  data: { netWorth: number; currentValue: number; totalPL: number; goalCount: number } | null
  onExport: () => Promise<void>
}

export default function DownloadReportSheet({ open, onClose, data, onExport }: Props) {
  const isVI = useLocale() === 'vi'
  const [mounted, setMounted] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      setSuccess(false)
      setExporting(false)
    } else {
      const t = setTimeout(() => setMounted(false), 220)
      return () => clearTimeout(t)
    }
  }, [open])

  async function handleExport() {
    setExporting(true)
    try {
      await onExport()
      setSuccess(true)
      setTimeout(() => { onClose() }, 2000)
    } catch {
      /* ignore */
    }
    setExporting(false)
  }

  if (!mounted) return null

  const today = new Date().toLocaleDateString(isVI ? 'vi-VN' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })

  const checklist = isVI
    ? ['Tổng tài sản ròng', 'Chi tiết từng mục tiêu', 'Phân bổ tài sản', 'Khoản đầu tư chưa phân bổ', 'Lịch sử giao dịch']
    : ['Net worth overview', 'Per-goal breakdown', 'Asset allocation', 'Unallocated holdings', 'Transaction history']

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.2)',
        zIndex: 100, pointerEvents: open ? 'auto' : 'none',
      }}
      onClick={onClose}
    >
      <div
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'var(--c-card)', borderRadius: '16px 16px 0 0',
          padding: '0 0 env(safe-area-inset-bottom,0)',
          animation: open
            ? 'slide-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1)'
            : 'slide-down 180ms ease forwards',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 36, height: 4, background: 'var(--c-line-strong)', borderRadius: 999, margin: '6px auto 0' }} />

        <div style={{ padding: '14px 16px 24px' }}>
          <p style={{ fontWeight: 700, fontSize: 17, color: 'var(--c-ink)', marginBottom: 4 }}>
            {isVI ? 'Báo cáo danh mục' : 'Portfolio report'}
          </p>
          <p style={{ fontSize: 13, color: 'var(--c-muted)', marginBottom: 20 }}>
            {isVI ? `Tính đến ${today}` : `As of ${today}`}
          </p>

          {data && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
              {[
                { label: isVI ? 'Tài sản ròng' : 'Net worth', value: fmt(data.netWorth) },
                { label: isVI ? 'Giá trị hiện tại' : 'Current value', value: fmt(data.currentValue) },
                {
                  label: 'Total P/L',
                  value: (data.totalPL >= 0 ? '+' : '') + fmt(data.totalPL),
                  color: data.totalPL >= 0 ? 'var(--c-pos)' : 'var(--c-neg)',
                },
                { label: isVI ? 'Số mục tiêu' : 'Goals tracked', value: String(data.goalCount) },
              ].map(({ label, value, color }) => (
                <div
                  key={label}
                  style={{
                    background: 'var(--c-card-2)', borderRadius: 12, padding: '12px 14px',
                  }}
                >
                  <p style={{ fontSize: 11, color: 'var(--c-muted)', marginBottom: 4 }}>{label}</p>
                  <p style={{ fontSize: 15, fontWeight: 700, color: color ?? 'var(--c-ink)' }}>{value}</p>
                </div>
              ))}
            </div>
          )}

          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)', marginBottom: 10 }}>
            {isVI ? 'Báo cáo bao gồm' : 'Report includes'}
          </p>
          <div style={{ marginBottom: 20 }}>
            {checklist.map((item) => (
              <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Check size={14} color="var(--c-pos)" />
                <span style={{ fontSize: 13, color: 'var(--c-ink)' }}>{item}</span>
              </div>
            ))}
          </div>

          {success ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '14px 0' }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: 'var(--c-pos-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Check size={18} color="var(--c-pos)" />
              </div>
              <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--c-pos)' }}>
                {isVI ? 'Đã xuất báo cáo' : 'Report exported'}
              </span>
            </div>
          ) : (
            <button
              onClick={handleExport}
              disabled={exporting}
              style={{
                width: '100%', padding: '14px 0', borderRadius: 12, border: 'none',
                background: 'var(--c-navy)', color: '#fff',
                fontSize: 15, fontWeight: 700,
                cursor: exporting ? 'default' : 'pointer',
                opacity: exporting ? 0.7 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              {exporting && (
                <span style={{ width: 16, height: 16, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.6s linear infinite' }} />
              )}
              {exporting
                ? (isVI ? 'Đang xuất…' : 'Exporting…')
                : (isVI ? 'Xuất báo cáo' : 'Export report')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
