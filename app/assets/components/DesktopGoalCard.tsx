'use client'

import { fmtCompact, fmtPct } from '@/lib/formatters'
import type { GoalData } from '../DashboardClient'

interface Props {
  goal: GoalData
  locale: string
  onClick: () => void
}

export default function DesktopGoalCard({ goal, locale, onClick }: Props) {
  const isPos = goal.profitLoss >= 0
  const progress = goal.progressPercentage ?? 0
  const isComplete = progress >= 100
  const isVi = locale === 'vi'

  return (
    <button
      onClick={onClick}
      className="cn-card"
      style={{
        width: '100%', textAlign: 'left', padding: '16px',
        cursor: 'pointer', display: 'block',
        border: '1px solid var(--c-line)',
        transition: 'box-shadow 120ms',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(15,42,74,0.10)' }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-card)' }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: '-0.005em' }}>
            {goal.goalName}
          </div>
          {goal.targetAmount && (
            <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 2 }}>
              {isVi ? 'Mục tiêu' : 'Target'} · {fmtCompact(goal.targetAmount)}
            </div>
          )}
        </div>
        {goal.progressPercentage !== null && (
          <span style={{
            display: 'inline-flex',
            padding: '3px 8px', borderRadius: 999,
            fontSize: 11, fontWeight: 700, flexShrink: 0,
            background: isComplete ? 'var(--c-pos-tint)' : 'var(--c-navy-tint)',
            color: isComplete ? 'var(--c-pos)' : 'var(--c-navy)',
          }}>
            {Math.min(progress, 100).toFixed(0)}%
          </span>
        )}
      </div>

      {/* Current value */}
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1, marginBottom: 12 }}>
        {fmtCompact(goal.currentValue)}
      </div>

      {/* Progress bar */}
      {goal.progressPercentage !== null && (
        <div style={{ height: 5, borderRadius: 999, background: 'var(--c-line)', overflow: 'hidden', marginBottom: 12 }}>
          <div style={{
            height: '100%',
            width: `${Math.min(progress, 100)}%`,
            borderRadius: 999,
            background: isComplete ? 'var(--c-pos)' : 'var(--c-navy)',
            transition: 'width 400ms ease',
          }} />
        </div>
      )}

      {/* P&L row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center',
          padding: '2px 6px', borderRadius: 999, fontSize: 11, fontWeight: 600,
          background: isPos ? 'var(--c-pos-tint)' : 'var(--c-neg-tint)',
          color: isPos ? 'var(--c-pos)' : 'var(--c-neg)',
        }}>
          {fmtPct(goal.profitLossPercentage)}
        </span>
        <span style={{ fontSize: 11, color: isPos ? 'var(--c-pos)' : 'var(--c-neg)', fontWeight: 500 }}>
          {isPos ? '+' : ''}{fmtCompact(goal.profitLoss)}
        </span>
        {goal.transactionCount > 0 && (
          <span style={{ fontSize: 11, color: 'var(--c-muted)', marginLeft: 'auto' }}>
            {goal.transactionCount} {isVi ? 'giao dịch' : 'holdings'}
          </span>
        )}
      </div>
    </button>
  )
}
