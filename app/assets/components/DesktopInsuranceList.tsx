'use client'

import { useState } from 'react'
import { Shield, Plus, AlertTriangle } from 'lucide-react'
import { fmtCompact } from '@/lib/formatters'
import type { InsuranceData } from '../DashboardClient'

interface Props {
  insurance: InsuranceData[]
  locale: string
  goalCount: number
  onOpen: (ins: InsuranceData) => void
  onAdd: () => void
}

const DISMISS_KEY = 'cairn.insuranceCoachDismissed'

const STATUS_COLOR: Record<string, string> = {
  on_track:  'var(--c-muted)',
  upcoming:  'var(--c-warn)',
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

export default function DesktopInsuranceList({ insurance, locale, goalCount, onOpen, onAdd }: Props) {
  const isVi = locale === 'vi'
  const isEmpty = insurance.length === 0

  const [coachDismissed, setCoachDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
  })
  function dismissCoach() {
    setCoachDismissed(true)
    try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ }
  }

  function statusLabel(s: string) {
    return isVi
      ? ({ on_track: 'Chưa đến hạn', completed: 'Đã thanh toán', overdue: 'Quá hạn', upcoming: 'Sắp đến hạn', ready: 'Đã tích lũy đủ' } as Record<string, string>)[s] ?? s
      : ({ on_track: 'Not due', completed: 'Paid', overdue: 'Overdue', upcoming: 'Due soon', ready: 'Ready to pay' } as Record<string, string>)[s] ?? s
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

      {/* Empty — risk-framed coach, dismissible to a quiet placeholder */}
      {isEmpty && !coachDismissed && (
        <div data-testid="insurance-empty">
          <div style={{
            padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--c-warn-tint)', color: 'var(--c-warn)',
            borderBottom: '1px solid rgba(180, 83, 9, 0.12)',
            fontSize: 11, fontWeight: 600, letterSpacing: '0.03em',
          }}>
            <AlertTriangle size={13} strokeWidth={2.2} />
            <span>{isVi ? `${goalCount} mục tiêu chưa được bảo vệ` : `${goalCount} goals are unprotected`}</span>
          </div>
          <div style={{ padding: '18px 20px 20px', display: 'flex', alignItems: 'center', gap: 24 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {isVi ? 'Thêm bảo hiểm để giữ vững kế hoạch' : 'Add insurance to keep your plan on track'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 4, lineHeight: 1.55, maxWidth: 520 }}>
                {isVi
                  ? 'Một sự cố y tế có thể buộc bạn rút từ các khoản đầu tư. Bảo hiểm giữ tiền của bạn cho mục tiêu đã định.'
                  : 'A medical event can force you to liquidate investments. Insurance keeps that money on its original goal.'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button data-testid="insurance-empty-later" onClick={dismissCoach} className="cn-btn ghost" style={{ color: 'var(--c-muted)' }}>
                {isVi ? 'Để sau' : 'Later'}
              </button>
              <button data-testid="insurance-empty-add" onClick={onAdd} className="cn-btn primary">
                <Plus size={13} strokeWidth={2.2} />
                {isVi ? 'Thêm thành viên' : 'Add member'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty — quiet placeholder after "Later" */}
      {isEmpty && coachDismissed && (
        <div data-testid="insurance-empty-quiet" style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10, background: 'var(--c-card-2)',
            color: 'var(--c-accent-insurance)', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Shield size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {isVi ? 'Chưa có thành viên nào' : 'No members yet'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 2, lineHeight: 1.5 }}>
              {isVi ? 'Bạn có thể thêm bất kỳ lúc nào.' : 'Add one whenever you’re ready.'}
            </div>
          </div>
          <button data-testid="insurance-empty-add" onClick={onAdd} className="cn-btn" style={{ padding: '7px 11px', fontSize: 12, gap: 4 }}>
            <Plus size={11} strokeWidth={2.4} />
            {isVi ? 'Thêm' : 'Add'}
          </button>
        </div>
      )}

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
