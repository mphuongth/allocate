'use client'

import { Shield } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { fmtCompact } from '@/lib/formatters'

interface Props {
  insuranceId: string
  insuranceName: string
  coverageType: string | null
  annualPremium: number
  amountSaved: number
  savingsProgressPercentage: number
  status: 'on_track' | 'upcoming' | 'overdue' | 'completed' | 'ready'
  isLast?: boolean
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

export default function InsuranceCard({
  insuranceName, coverageType, annualPremium, amountSaved,
  savingsProgressPercentage, status, isLast,
}: Props) {
  const t = useTranslations('dashboard')

  const dotColor = STATUS_COLOR[status] ?? 'var(--c-muted)'
  const bar = BAR_COLOR[status] ?? 'var(--c-warn)'
  const progress = Math.min(savingsProgressPercentage, 100)

  const statusLabel: Record<string, string> = {
    on_track:  t('statusDue'),
    upcoming:  t('statusNotDue'),
    overdue:   t('statusOverdue'),
    completed: t('statusCompleted'),
    ready:     t('statusReady'),
  }

  return (
    <div style={{
      padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12,
      borderBottom: isLast ? 'none' : '1px solid var(--c-line)',
    }}>
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
            {statusLabel[status] ?? status}
          </span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
          {fmtCompact(amountSaved)} / {fmtCompact(annualPremium)}
        </div>
      </div>
    </div>
  )
}
