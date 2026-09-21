import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import messages from '@/messages/vi.json'
import ChallengeTodayCard from '../ChallengeTodayCard'
import { challengeMonthState } from '@/lib/savingsChallenge'
import type { SavingsChallengeState } from '@/features/challenge/useSavingsChallenge'

// The dashboard's one daily action.
//
// Most of what this card does is decline to appear. It sits on a screen full of
// real money, so it has to be silent about everything that is not today's step:
// no error banner (the month view owns the retry), no empty-state invitation, no
// loading placeholder. Those are the cases worth pinning — a card that renders
// a broken or nagging state on the dashboard is the failure mode here.

const NOW = new Date('2026-09-16T00:30:00Z')  // the 16th, 07:30 in Vietnam

function stateFor({
  unitVnd = 1000 as number | null,
  days = [] as number[],
  month = 9,
  loading = false,
  error = false,
  busy = false,
} = {}): SavingsChallengeState {
  return {
    challenge: unitVnd === null ? null : { challenge_id: 'c-1', year: 2026, month, unit_vnd: unitVnd },
    unitVnd,
    days,
    view: challengeMonthState({ year: 2026, month, unitVnd, checkedDays: days, now: NOW }),
    loading,
    error,
    busy,
    reload: vi.fn(),
    start: vi.fn(async () => true),
    restep: vi.fn(async () => true),
    abandon: vi.fn(async () => true),
    toggleDay: vi.fn(async () => true),
  }
}

const show = (state: SavingsChallengeState) =>
  render(
    <NextIntlClientProvider locale="vi" messages={messages}>
      <ChallengeTodayCard state={state} />
    </NextIntlClientProvider>,
  )

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('what today asks for', () => {
  it('names the day and its amount', () => {
    show(stateFor({ unitVnd: 1000 }))
    expect(screen.getByText('Hôm nay, ngày 16')).toBeInTheDocument()
    // (30 + 1 - 16) x 1,000
    expect(screen.getByText('₫ 15.000')).toBeInTheDocument()
  })

  it('scales with the month’s step', () => {
    show(stateFor({ unitVnd: 10000 }))
    expect(screen.getByText('₫ 150.000')).toBeInTheDocument()
  })

  it('sets today aside, without the user naming the day', async () => {
    const state = stateFor({ unitVnd: 1000 })
    show(state)
    await userEvent.click(screen.getByRole('button', { name: 'Để dành' }))
    expect(state.toggleDay).toHaveBeenCalledWith(16)
  })

  it('shows today as done, and lets it be taken back', async () => {
    const state = stateFor({ unitVnd: 1000, days: [16] })
    show(state)
    const button = screen.getByRole('button', { name: /Đã để dành/ })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(button)
    expect(state.toggleDay).toHaveBeenCalledWith(16)
  })

  it('carries the month’s running count and a way into the month view', () => {
    show(stateFor({ unitVnd: 1000, days: [1, 16] }))
    expect(screen.getByText(/2\/30 ngày/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Xem cả tháng' })).toHaveAttribute('href', '/planning')
  })

  it('does not act twice while a write is in flight', () => {
    show(stateFor({ unitVnd: 1000, busy: true }))
    expect(screen.getByRole('button', { name: 'Để dành' })).toBeDisabled()
  })
})

describe('when it has nothing to say', () => {
  const silent = (state: SavingsChallengeState) => {
    const { container } = show(state)
    expect(container).toBeEmptyDOMElement()
  }

  it('says nothing when no challenge is running', () => {
    // The invitation to start one belongs on Planning, next to the other
    // monthly decisions — not as a nag on a dashboard of real balances.
    silent(stateFor({ unitVnd: null }))
  })

  it('says nothing while the month is still loading', () => {
    silent(stateFor({ unitVnd: null, loading: true }))
  })

  it('says nothing when the month could not be read', () => {
    // The month view owns the retry. A second error surface here would report
    // the same failure twice and offer no way to fix it.
    silent(stateFor({ unitVnd: null, error: true }))
  })
})
