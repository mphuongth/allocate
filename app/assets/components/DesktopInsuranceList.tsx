'use client'

import { Shield, Plus } from 'lucide-react'
import { fmtCompact } from '@/lib/formatters'
import type { InsuranceData } from '../DashboardClient'

interface Props {
  insurance: InsuranceData[]
  locale: string
  onOpen: (ins: InsuranceData) => void
  onAdd: () => void
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

export default function DesktopInsuranceList({ insurance, locale, onOpen, onAdd }: Props) {
  const isVi = locale === 'vi'

  function statusLabel(s: string) {
    return isVi
      ? ({ on_track: 'Sắp đến hạn', completed: 'Đã thanh toán', overdue: 'Quá hạn', upcoming: 'Chưa đến hạn', ready: 'Sẵn sàng' } as Record<string, string>)[s] ?? s
      : ({ on_track: 'Due soon', completed: 'Paid', overdue: 'Overdue', upcoming: 'Not due', ready: 'Ready' } as Record<string, string>)[s] ?? s
  }

  return (
    <div className="cn-card" style={{ overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '14px 16px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--c-line)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'var(--c-card-2)', color: 'var(--c-accent-insurance)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Shield size={15} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{isVi ? 'Bảo hiểm' : 'Insurance'}</div>
            <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 1 }}>
              {insurance.length} {isVi ? 'thành viên' : insurance.length === 1 ? 'member' : 'members'}
            </div>
          </div>
        </div>
        <button
          data-testid="insurance-add-btn"
          onClick={onAdd}
          className="cn-btn ghost"
          style={{ padding: '5px 10px', fontSize: 12, gap: 4 }}
        >
          <Plus size={12} strokeWidth={2.4} />
          {isVi ? 'Thêm' : 'Add'}
        </button>
      </div>

      {/* Rows */}
      {insurance.map((ins, i) => {
        const dotColor = STATUS_COLOR[ins.status] ?? 'var(--c-muted)'
        const barColor = BAR_COLOR[ins.status] ?? 'var(--c-warn)'
        const progress = Math.min(ins.savingsProgressPercentage, 100)
        const isLast = i === insurance.length - 1

        return (
          <button
            key={ins.insuranceId}
            data-testid="insurance-row"
            onClick={() => onOpen(ins)}
            style={{
              width: '100%', textAlign: 'left', background: 'transparent', border: 'none',
              borderBottom: isLast ? 'none' : '1px solid var(--c-line)',
              padding: '12px 16px', cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 12, transition: 'background 120ms',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--c-card-2)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)' }}>{ins.insuranceName}</span>
                {ins.coverageType && (
                  <span style={{ fontSize: 11, color: 'var(--c-muted)' }}>· {ins.coverageType}</span>
                )}
              </div>
              <div style={{ marginTop: 6 }}>
                <div style={{ width: '100%', height: 4, background: 'var(--c-card-2)', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${progress}%`, background: barColor, borderRadius: 999, transition: 'width 400ms ease' }} />
                </div>
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: dotColor, display: 'inline-block' }} />
                <span style={{ fontSize: 10, fontWeight: 600, color: dotColor }}>{statusLabel(ins.status)}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                {fmtCompact(ins.amountSaved)} / {fmtCompact(ins.annualPremium)}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
