'use client'

import { ChevronLeft, Shield } from 'lucide-react'
import { fmtCompact } from '@/lib/formatters'
import type { InsuranceData } from '../DashboardClient'

interface Props {
  ins: InsuranceData
  locale: string
  onClose: () => void
}

const STATUS_COLOR: Record<string, string> = {
  on_track:  'var(--c-warn)',
  upcoming:  'var(--c-muted)',
  overdue:   'var(--c-neg)',
  completed: 'var(--c-pos)',
  ready:     'var(--c-navy)',
}

const BAR_COLOR: Record<string, string> = {
  on_track:  'var(--c-warn)',
  upcoming:  'var(--c-warn)',
  overdue:   'var(--c-neg)',
  completed: 'var(--c-pos)',
  ready:     'var(--c-warn)',
}

export default function DesktopInsuranceDetail({ ins, locale, onClose }: Props) {
  const isVi = locale === 'vi'
  const progress = Math.min(ins.savingsProgressPercentage, 100)
  const barColor = BAR_COLOR[ins.status] ?? 'var(--c-warn)'
  const dotColor = STATUS_COLOR[ins.status] ?? 'var(--c-muted)'

  function statusLabel(s: string) {
    return isVi
      ? ({ on_track: 'Sắp đến hạn', completed: 'Đã thanh toán', overdue: 'Quá hạn', upcoming: 'Chưa đến hạn', ready: 'Sẵn sàng' } as Record<string, string>)[s] ?? s
      : ({ on_track: 'Due soon', completed: 'Paid', overdue: 'Overdue', upcoming: 'Not due', ready: 'Ready' } as Record<string, string>)[s] ?? s
  }

  return (
    <div data-testid="insurance-detail-panel" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Back button */}
      <button
        onClick={onClose}
        className="cn-btn ghost"
        style={{ alignSelf: 'flex-start', padding: '6px 0', gap: 4, fontSize: 12, color: 'var(--c-muted)' }}
      >
        <ChevronLeft size={14} />
        {isVi ? 'Quay lại' : 'Back'}
      </button>

      {/* Summary card */}
      <div className="cn-card" style={{ padding: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 9,
            background: 'var(--c-card-2)', color: 'var(--c-accent-insurance)',
            border: '1px solid var(--c-line)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Shield size={16} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-muted)', marginBottom: 2 }}>
              {isVi ? 'Bảo hiểm' : 'Insurance'}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ins.insuranceName}
            </div>
            {ins.coverageType && (
              <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 2 }}>{ins.coverageType}</div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: dotColor, display: 'inline-block' }} />
            <span style={{ fontSize: 10, fontWeight: 600, color: dotColor }}>{statusLabel(ins.status)}</span>
          </div>
        </div>

        {/* Progress */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--c-muted)' }}>
              {isVi ? 'Đã tích lũy' : 'Saved'}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>
              {Math.round(progress)}%
            </span>
          </div>
          <div style={{ width: '100%', height: 6, background: 'var(--c-card-2)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: barColor, borderRadius: 999, transition: 'width 400ms ease' }} />
          </div>
        </div>

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1, background: 'var(--c-line)', borderRadius: 10, overflow: 'hidden' }}>
          {[
            { l: isVi ? 'Phí hàng năm' : 'Annual premium', v: fmtCompact(ins.annualPremium) },
            { l: isVi ? 'Đã tích lũy' : 'Saved', v: fmtCompact(ins.amountSaved) },
            ...(ins.nextPaymentDate ? [{ l: isVi ? 'Kỳ hạn tiếp' : 'Next due', v: new Date(ins.nextPaymentDate).toLocaleDateString(isVi ? 'vi-VN' : 'en-GB') }] : []),
            ...(ins.lastPaymentDate ? [{ l: isVi ? 'Lần trả cuối' : 'Last paid', v: new Date(ins.lastPaymentDate).toLocaleDateString(isVi ? 'vi-VN' : 'en-GB') }] : []),
          ].map((k, i) => (
            <div key={i} style={{ background: 'var(--c-card)', padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: 'var(--c-muted)' }}>{k.l}</div>
              <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{k.v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Manage link */}
      <a
        href="/settings?tab=insurance"
        className="cn-btn"
        style={{ width: '100%', justifyContent: 'center', fontSize: 13, padding: '10px 14px', textDecoration: 'none' }}
      >
        {isVi ? 'Quản lý bảo hiểm' : 'Manage insurance'}
      </a>
    </div>
  )
}
