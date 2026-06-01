'use client'

import { useTranslations } from 'next-intl'
import { fmt, fmtCompact, fmtPct } from '@/lib/formatters'

interface Props {
  goalName: string
  targetAmount: number | null
  currentValue: number
  profitLoss: number
  profitLossPercentage: number
  progressPercentage: number | null
  transactionCount: number
  onClick: () => void
}

export default function GoalCard({
  goalName, targetAmount, currentValue,
  profitLoss, profitLossPercentage, progressPercentage, transactionCount,
  onClick,
}: Props) {
  const t = useTranslations('dashboard')
  const plPositive = profitLoss >= 0
  const progress = Math.min(progressPercentage ?? 0, 100)
  const isComplete = progressPercentage !== null && progressPercentage >= 100

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', textAlign: 'left', cursor: 'pointer',
        background: 'var(--c-card)',
        border: '1px solid var(--c-line)',
        borderRadius: 'var(--r-card)',
        boxShadow: 'var(--shadow-card)',
        padding: '16px',
        display: 'block',
        fontFamily: 'inherit',
        transition: 'box-shadow 120ms, border-color 120ms',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.boxShadow = 'var(--shadow-pop)')}
      onMouseLeave={(e) => (e.currentTarget.style.boxShadow = 'var(--shadow-card)')}
    >
      {/* Header: name + progress % chip */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 14, fontWeight: 600, color: 'var(--c-ink)',
            letterSpacing: '-0.005em',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {goalName}
          </div>
          {targetAmount != null && (
            <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
              {t('goalTarget', { amount: fmtCompact(targetAmount) })}
            </div>
          )}
        </div>
        {progressPercentage !== null && (
          <span style={{
            display: 'inline-flex', alignItems: 'center',
            fontSize: 11, fontWeight: 500, padding: '3px 8px', borderRadius: 999,
            background: isComplete ? 'var(--c-pos-tint)' : 'var(--c-navy-tint)',
            color: isComplete ? 'var(--c-pos)' : 'var(--c-navy)',
            flexShrink: 0,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {Math.round(progress)}%
          </span>
        )}
      </div>

      {/* Current value */}
      <div style={{
        fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em',
        marginTop: 10, fontVariantNumeric: 'tabular-nums',
        overflowWrap: 'break-word', wordBreak: 'break-word', lineHeight: 1.2,
      }}>
        {fmt(currentValue)}
      </div>

      {/* Progress bar */}
      {targetAmount != null && (
        <div style={{ marginTop: 10 }}>
          <div style={{
            width: '100%', height: 6,
            background: 'var(--c-card-2)', borderRadius: 999, overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', borderRadius: 999,
              width: `${progress}%`,
              background: isComplete ? 'var(--c-pos)' : 'var(--c-navy)',
              transition: 'width 400ms ease',
            }} />
          </div>
        </div>
      )}

      {/* Footer: P&L */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginTop: 10, fontSize: 11, color: 'var(--c-muted)',
      }}>
        <span style={{
          color: plPositive ? 'var(--c-pos)' : 'var(--c-neg)',
          fontWeight: 500, fontVariantNumeric: 'tabular-nums',
        }}>
          {profitLoss >= 0 ? '+' : ''}{fmtCompact(profitLoss)} · {fmtPct(profitLossPercentage)}
        </span>
        <span>{t('transactions', { count: transactionCount })}</span>
      </div>
    </button>
  )
}
