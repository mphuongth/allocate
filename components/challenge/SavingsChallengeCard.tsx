'use client'

// The month's savings challenge, in full — the tier picker before one is
// chosen, and the day grid afterwards.
//
// The grid is the feature: thirty-odd cells, heaviest first, each one a button
// that says what that day asks for and whether it has been set aside. Showing
// the amount ON the cell rather than only the day number is what makes the
// schedule legible at a glance — the whole point of the picture this came from
// is that you can see the number shrinking.
//
// Every disabled state is derived from `view`, which mirrors the database's own
// rules (lib/savingsChallenge). A control the server would refuse is greyed out
// here instead, so the user meets the rule as a shape on screen rather than as
// an error toast.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, Lock } from 'lucide-react'
import { fmt, fmtCompact } from '@/lib/formatters'
import {
  CHALLENGE_TIERS, challengeTotalVnd, type ChallengeTier,
} from '@/lib/savingsChallenge'
import type { SavingsChallengeState } from '@/features/challenge/useSavingsChallenge'

const cardStyle: React.CSSProperties = {
  background: 'var(--c-card)',
  border: '1px solid var(--c-line)',
  borderRadius: 16,
  padding: 18,
}

export default function SavingsChallengeCard({
  year, month, state,
}: {
  year: number
  month: number
  state: SavingsChallengeState
}) {
  const t = useTranslations('challenge')
  const { challenge, view, loading, error, busy } = state
  const [picking, setPicking] = useState(false)
  const [confirmingCancel, setConfirmingCancel] = useState(false)

  if (loading) {
    return (
      <section style={cardStyle} aria-busy="true">
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{t('title')}</h2>
        <div
          data-testid="challenge-skeleton"
          style={{ marginTop: 12, height: 96, borderRadius: 12, background: 'var(--c-card-2)' }}
        />
      </section>
    )
  }

  if (error) {
    return (
      <section style={cardStyle}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{t('title')}</h2>
        <p style={{ margin: '10px 0 12px', fontSize: 13, color: 'var(--c-muted)' }}>{t('loadError')}</p>
        <button onClick={state.reload} style={ghost}>{t('retry')}</button>
      </section>
    )
  }

  // ── nothing chosen yet ────────────────────────────────────────────────────
  //
  // A month that has already ended never gets the picker: starting a challenge
  // for a month you cannot tick a single day of would only create history that
  // did not happen.
  if (!challenge) {
    return (
      <section style={cardStyle}>
        <Header title={t('title')} subtitle={view.isCurrentMonth ? t('pickPrompt') : t('monthClosedEmpty')} />
        {view.isCurrentMonth && (
          <TierChoices busy={busy} onPick={tier => state.start(tier)} year={year} month={month} t={t} />
        )}
      </section>
    )
  }

  const tier = challenge.tier
  const canEditTier = view.isCurrentMonth && !view.locked

  return (
    <section style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <Header
          title={t('title')}
          subtitle={t('tierOf', { tier, total: fmt(challengeTotalVnd(year, month, tier)) })}
        />
        {canEditTier ? (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button onClick={() => setPicking(p => !p)} disabled={busy} style={ghost}>
              {t('changeTier')}
            </button>
            <button onClick={() => setConfirmingCancel(true)} disabled={busy} style={ghost}>
              {t('cancelChallenge')}
            </button>
          </div>
        ) : view.isCurrentMonth ? (
          // The lock is the feature, so it is stated rather than implied by two
          // missing buttons.
          <span
            data-testid="challenge-lock"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
              fontSize: 11.5, color: 'var(--c-muted)', border: '1px solid var(--c-line)',
              borderRadius: 999, padding: '4px 9px',
            }}
          >
            <Lock size={11} strokeWidth={2.2} />
            {t('locked')}
          </span>
        ) : null}
      </div>

      {picking && canEditTier && (
        <TierChoices
          busy={busy}
          current={tier}
          year={year}
          month={month}
          t={t}
          onPick={async next => { if (await state.retier(next)) setPicking(false) }}
        />
      )}

      {confirmingCancel && canEditTier && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: 'var(--c-card-2)' }}>
          <p style={{ margin: '0 0 10px', fontSize: 13 }}>{t('confirmCancel')}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setConfirmingCancel(false)} style={ghost}>{t('keep')}</button>
            <button
              onClick={async () => { if (await state.abandon()) setConfirmingCancel(false) }}
              disabled={busy}
              style={{ ...ghost, color: 'var(--c-danger, #c0392b)' }}
            >
              {t('cancelChallenge')}
            </button>
          </div>
        </div>
      )}

      <Progress view={view} t={t} />

      <div
        role="group"
        aria-label={t('daysLabel')}
        style={{
          marginTop: 14,
          display: 'grid',
          // Cells size themselves, so one rule serves the narrow phone column
          // and the wide desktop panel without a viewport branch.
          gridTemplateColumns: 'repeat(auto-fill, minmax(62px, 1fr))',
          gap: 6,
        }}
      >
        {view.schedule.map(({ day, amountVnd }) => {
          const ticked = state.days.includes(day)
          // A ticked day stays pressable all month so a mistake can be undone;
          // an unticked one waits for its turn.
          const enabled = view.isCurrentMonth && (ticked || view.canTick(day))
          return (
            <button
              key={day}
              type="button"
              aria-pressed={ticked}
              aria-label={t('dayLabel', { day, amount: fmt(amountVnd) })}
              disabled={!enabled}
              onClick={() => state.toggleDay(day)}
              style={{
                position: 'relative',
                padding: '7px 4px 6px',
                borderRadius: 10,
                border: `1px solid ${ticked ? 'var(--c-accent, #10B981)' : 'var(--c-line)'}`,
                background: ticked ? 'var(--c-accent-soft, rgba(16,185,129,0.12))' : 'var(--c-card-2)',
                color: enabled || ticked ? 'var(--c-ink)' : 'var(--c-muted)',
                opacity: enabled || ticked ? 1 : 0.55,
                cursor: enabled ? 'pointer' : 'default',
                fontFamily: 'inherit',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              }}
            >
              <span style={{ fontSize: 10.5, color: 'var(--c-muted)', lineHeight: 1 }}>{day}</span>
              <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.1 }}>{fmtCompact(amountVnd)}</span>
              {ticked && (
                <Check
                  size={11}
                  strokeWidth={3}
                  aria-hidden
                  style={{ position: 'absolute', top: 3, right: 3, color: 'var(--c-accent, #10B981)' }}
                />
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>{title}</h2>
      <p style={{ margin: '3px 0 0', fontSize: 12.5, color: 'var(--c-muted)' }}>{subtitle}</p>
    </div>
  )
}

function Progress({
  view, t,
}: {
  view: SavingsChallengeState['view']
  t: ReturnType<typeof useTranslations<'challenge'>>
}) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <strong style={{ fontSize: 17, fontWeight: 700 }}>{fmt(view.savedVnd)}</strong>
        <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>
          {t('ofTarget', { target: fmt(view.targetVnd), done: view.checkedCount, days: view.totalDays })}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(view.pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{ marginTop: 7, height: 7, borderRadius: 999, background: 'var(--c-card-2)', overflow: 'hidden' }}
      >
        <div
          style={{
            width: `${Math.min(100, view.pct)}%`, height: '100%',
            background: 'var(--c-accent, #10B981)', borderRadius: 999,
          }}
        />
      </div>
      {/* Measured against the days that have PASSED, not the whole month — see
          challengeMonthState. Telling someone on the 2nd that they are 400k
          behind is both untrue and the fastest way to make them stop. */}
      <p style={{ margin: '7px 0 0', fontSize: 12, color: view.behindVnd > 0 ? 'var(--c-warn, #b7791f)' : 'var(--c-muted)' }}>
        {view.behindVnd > 0 ? t('behind', { amount: fmt(view.behindVnd) }) : t('onTrack')}
      </p>
    </div>
  )
}

function TierChoices({
  busy, current, year, month, t, onPick,
}: {
  busy: boolean
  current?: ChallengeTier
  year: number
  month: number
  t: ReturnType<typeof useTranslations<'challenge'>>
  onPick: (tier: ChallengeTier) => void
}) {
  return (
    <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
      {CHALLENGE_TIERS.map(tier => (
        <button
          key={tier}
          type="button"
          disabled={busy || tier === current}
          aria-current={tier === current}
          onClick={() => onPick(tier)}
          style={{
            padding: '11px 6px', borderRadius: 12, cursor: busy ? 'default' : 'pointer',
            border: `1px solid ${tier === current ? 'var(--c-accent, #10B981)' : 'var(--c-line)'}`,
            background: tier === current ? 'var(--c-accent-soft, rgba(16,185,129,0.12))' : 'var(--c-card-2)',
            color: 'var(--c-ink)', fontFamily: 'inherit',
          }}
        >
          <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>{t('tier', { tier })}</span>
          {/* The month's real total, not a generic one: it is what actually
              differs between a 28-day February and a 31-day October. */}
          <span style={{ display: 'block', marginTop: 3, fontSize: 11.5, color: 'var(--c-muted)' }}>
            {fmt(challengeTotalVnd(year, month, tier))}
          </span>
        </button>
      ))}
    </div>
  )
}

const ghost: React.CSSProperties = {
  padding: '6px 10px', borderRadius: 9, border: '1px solid var(--c-line)',
  background: 'var(--c-card)', color: 'var(--c-ink)', fontSize: 12, fontWeight: 500,
  cursor: 'pointer', fontFamily: 'inherit',
}
