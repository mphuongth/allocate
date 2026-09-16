'use client'

// Today's step of the savings challenge, on the dashboard.
//
// The month view lives on Planning, because picking a tier is a monthly
// decision. Ticking a day is not — it is a daily one, and it belongs on the
// screen the user actually opens every day. So this card carries exactly one
// action: today's amount, and a button that sets it aside.
//
// It renders nothing at all when there is no challenge and the user has never
// started one. A habit tracker that nags from an empty state on a dashboard full
// of real money is noise; the invitation belongs on Planning, next to the other
// monthly decisions.

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Check } from 'lucide-react'
import { fmt } from '@/lib/formatters'
import type { SavingsChallengeState } from '@/features/challenge/useSavingsChallenge'

export default function ChallengeTodayCard({
  state, style,
}: {
  state: SavingsChallengeState
  style?: React.CSSProperties
}) {
  const t = useTranslations('challenge')
  const { challenge, view, loading, error, busy } = state

  // Silent while loading, on a failed read, and when this month has no
  // challenge. The dashboard is the wrong place to report either — the month
  // view has a retry, and this card has nothing to say without a tier.
  if (loading || error || !challenge || !view.isCurrentMonth || view.today === null) return null

  const done = view.todayChecked

  return (
    <section
      style={{
        background: 'var(--c-card)', border: '1px solid var(--c-line)',
        borderRadius: 16, padding: 16, display: 'flex', alignItems: 'center', gap: 14,
        ...style,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--c-muted)' }}>
          {t('todayTitle', { day: view.today })}
        </p>
        <strong style={{ display: 'block', marginTop: 2, fontSize: 19, fontWeight: 700, letterSpacing: '-0.01em' }}>
          {fmt(view.todayAmountVnd)}
        </strong>
        <p style={{ margin: '4px 0 0', fontSize: 11.5, color: 'var(--c-muted)' }}>
          {t('ofTarget', {
            target: fmt(view.targetVnd), done: view.checkedCount, days: view.totalDays,
          })}
          {' · '}
          <Link href="/planning" style={{ color: 'inherit', textDecoration: 'underline' }}>
            {t('seeMonth')}
          </Link>
        </p>
      </div>

      <button
        type="button"
        aria-pressed={done}
        disabled={busy}
        onClick={() => state.toggleDay(view.today as number)}
        style={{
          flexShrink: 0, minWidth: 92, padding: '10px 14px', borderRadius: 12,
          border: `1px solid ${done ? 'var(--c-accent, #10B981)' : 'var(--c-line)'}`,
          background: done ? 'var(--c-accent-soft, rgba(16,185,129,0.12))' : 'var(--c-btn-primary)',
          color: done ? 'var(--c-ink)' : '#fff',
          fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
          cursor: busy ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}
      >
        {done && <Check size={14} strokeWidth={3} aria-hidden />}
        {done ? t('todayDone') : t('markToday')}
      </button>
    </section>
  )
}
