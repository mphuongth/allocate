'use client'

import { Shield, ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { fmtCompact } from '@/lib/formatters'
import { STATUS_COLOR, BAR_COLOR, insurancePaidState } from './insuranceShared'

interface Props {
  insuranceName: string
  coverageType: string | null
  annualPremium: number
  amountSaved: number
  savingsProgressPercentage: number
  status: 'on_track' | 'upcoming' | 'overdue' | 'completed' | 'ready'
  lastPaymentDate?: string | null
  isLast?: boolean
  onClick?: () => void
}

export default function InsuranceCard({
  insuranceName, coverageType, annualPremium, amountSaved,
  savingsProgressPercentage, status, lastPaymentDate, isLast, onClick,
}: Props) {
  const t = useTranslations('dashboard')

  const { paidYear, effectiveStatus } = insurancePaidState(status, lastPaymentDate)
  const dotColor = STATUS_COLOR[effectiveStatus] ?? 'var(--c-muted)'
  const bar = BAR_COLOR[effectiveStatus] ?? 'var(--c-warn)'
  const progress = Math.min(savingsProgressPercentage, 100)

  const statusLabel: Record<string, string> = {
    on_track:  t('statusNotDue'),
    upcoming:  t('statusDue'),
    overdue:   t('statusOverdue'),
    completed: t('statusCompleted'),
    ready:     t('statusReady'),
  }
  const label = paidYear !== null ? t('statusPaidForYear', { year: paidYear }) : (statusLabel[status] ?? status)

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
      style={{
        padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12,
        borderBottom: isLast ? 'none' : '1px solid var(--c-line)',
        cursor: onClick ? 'pointer' : undefined,
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
        background: 'var(--c-card-2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--c-accent-insurance)',
      }}>
        <Shield size={16} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-ink)' }}>{insuranceName}</span>
          {coverageType && <span style={{ fontSize: 11, color: 'var(--c-muted)' }}>· {coverageType}</span>}
        </div>
        <div style={{ marginTop: 4 }}>
          <div style={{ width: '100%', height: 4, background: 'var(--c-card-2)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ height: '100%', borderRadius: 999, width: `${progress}%`, background: bar, transition: 'width 400ms ease' }} />
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: dotColor, display: 'inline-block' }} />
          <span style={{ fontSize: 10, fontWeight: 500, color: dotColor, letterSpacing: '0.02em' }}>
            {label}
          </span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
          {fmtCompact(amountSaved)} / {fmtCompact(annualPremium)}
        </div>
      </div>

      {onClick && (
        <ChevronRight size={16} style={{ flexShrink: 0, color: 'var(--c-muted)' }} />
      )}
    </div>
  )
}
