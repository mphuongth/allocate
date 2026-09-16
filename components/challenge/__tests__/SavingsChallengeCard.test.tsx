import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import messages from '@/messages/vi.json'
import SavingsChallengeCard from '../SavingsChallengeCard'
import { challengeMonthState, type ChallengeTier } from '@/lib/savingsChallenge'
import type { SavingsChallengeState } from '@/features/challenge/useSavingsChallenge'

// What the user actually sees — which is where the rules have to land.
//
// The database refuses a locked re-tier and a future day, and the routes turn
// those into 409s. Neither is a good way for a person to find out. So the card
// has to express the same rules as SHAPE: no change-tier button once a day is
// ticked, a future cell that cannot be pressed, a closed month with no controls
// at all. These specs assert the rendered outcome, not the props that produced
// it.
//
// Rendered through the real Vietnamese message file rather than a mocked
// translator, so a key that never made it into messages/vi.json fails here
// instead of shipping as "challenge.tierOf".

const NOW = new Date('2026-09-16T00:30:00Z')  // the 16th, 07:30 in Vietnam

function stateFor({
  tier = 1 as ChallengeTier | null,
  days = [] as number[],
  year = 2026,
  month = 9,
  loading = false,
  error = false,
  actions = {} as Partial<SavingsChallengeState>,
} = {}): SavingsChallengeState {
  return {
    challenge: tier === null ? null : { challenge_id: 'c-1', year, month, tier },
    days,
    view: challengeMonthState({ year, month, tier, checkedDays: days, now: NOW }),
    loading,
    error,
    busy: false,
    reload: vi.fn(),
    start: vi.fn(async () => true),
    retier: vi.fn(async () => true),
    abandon: vi.fn(async () => true),
    toggleDay: vi.fn(async () => true),
    ...actions,
  }
}

const show = (state: SavingsChallengeState, year = 2026, month = 9) =>
  render(
    <NextIntlClientProvider locale="vi" messages={messages}>
      <SavingsChallengeCard year={year} month={month} state={state} />
    </NextIntlClientProvider>,
  )

const dayCell = (day: number) =>
  screen.getByRole('button', { name: new RegExp(`^Ngày ${day} —`) })

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('before a tier is picked', () => {
  it('offers the three tiers with THIS month’s totals', () => {
    show(stateFor({ tier: null }))
    // September has 30 days: 465,000 / 2,325,000 / 4,650,000.
    expect(screen.getByRole('button', { name: /Mức 1/ })).toHaveTextContent('465.000')
    expect(screen.getByRole('button', { name: /Mức 2/ })).toHaveTextContent('2.325.000')
    expect(screen.getByRole('button', { name: /Mức 3/ })).toHaveTextContent('4.650.000')
  })

  it('offers no picker for a month that has not begun', () => {
    // Starting next month early would create a challenge with no tickable day
    // in it — the card offers the pick when the month arrives, not before.
    show(stateFor({ tier: null, month: 10 }), 2026, 10)
    expect(screen.queryByRole('button', { name: /Mức 1/ })).not.toBeInTheDocument()
  })

  it('starts the month at the tier pressed', async () => {
    const state = stateFor({ tier: null })
    show(state)
    await userEvent.click(screen.getByRole('button', { name: /Mức 2/ }))
    expect(state.start).toHaveBeenCalledWith(2)
  })

  it('offers no picker for a month that has already ended', () => {
    show(stateFor({ tier: null, month: 8 }), 2026, 8)
    expect(screen.queryByRole('button', { name: /Mức 1/ })).not.toBeInTheDocument()
    expect(screen.getByText(/không chạy thử thách/i)).toBeInTheDocument()
  })
})

describe('the day grid', () => {
  it('runs backwards — the 1st asks the most, the last the least', () => {
    show(stateFor({ tier: 1 }))
    expect(dayCell(1)).toHaveAccessibleName('Ngày 1 — ₫ 30.000')
    expect(dayCell(30)).toHaveAccessibleName('Ngày 30 — ₫ 1.000')
    expect(screen.queryByRole('button', { name: /^Ngày 31 —/ })).not.toBeInTheDocument()
  })

  it('has one cell per real day of a 31-day month', () => {
    show(stateFor({ tier: 1, month: 10 }), 2026, 10)
    expect(dayCell(1)).toHaveAccessibleName('Ngày 1 — ₫ 31.000')
    expect(dayCell(31)).toHaveAccessibleName('Ngày 31 — ₫ 1.000')
  })

  it('ticks a day that has passed', async () => {
    const state = stateFor({ tier: 1 })
    show(state)
    await userEvent.click(dayCell(5))
    expect(state.toggleDay).toHaveBeenCalledWith(5)
  })

  it('will not let a day that has not arrived be pressed', async () => {
    const state = stateFor({ tier: 1 })
    show(state)
    expect(dayCell(17)).toBeDisabled()
    await userEvent.click(dayCell(17))
    expect(state.toggleDay).not.toHaveBeenCalled()
  })

  it('marks what has been set aside, and lets it be undone', async () => {
    const state = stateFor({ tier: 1, days: [3] })
    show(state)
    expect(dayCell(3)).toHaveAttribute('aria-pressed', 'true')
    expect(dayCell(4)).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(dayCell(3))
    expect(state.toggleDay).toHaveBeenCalledWith(3)
  })
})

describe('the running total', () => {
  it('adds up only the days that were ticked', () => {
    // 30,000 + 29,000 + 1,000
    show(stateFor({ tier: 1, days: [1, 2, 30] }))
    expect(screen.getByText('₫ 60.000')).toBeInTheDocument()
    expect(screen.getByText(/3\/30 ngày/)).toBeInTheDocument()
  })

  it('measures the shortfall against the days so far, not the whole month', () => {
    // Due through the 16th is 360,000; two days ticked is 59,000.
    show(stateFor({ tier: 1, days: [1, 2] }))
    expect(screen.getByText(/Đang thiếu ₫ 301\.000/)).toBeInTheDocument()
  })

  it('says so when nothing is owed', () => {
    const everyPastDay = Array.from({ length: 16 }, (_, i) => i + 1)
    show(stateFor({ tier: 1, days: everyPastDay }))
    expect(screen.getByText(/Đang theo kịp/)).toBeInTheDocument()
  })

  it('reports progress on the bar as well as in the text', () => {
    show(stateFor({ tier: 1, days: [1] }))
    // 30,000 of 465,000 — 6.45%, shown rounded.
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '6')
  })
})

describe('the lock', () => {
  it('offers a change of tier while nothing has been ticked', () => {
    show(stateFor({ tier: 1 }))
    expect(screen.getByRole('button', { name: 'Đổi mức' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Huỷ thử thách' })).toBeInTheDocument()
    expect(screen.queryByTestId('challenge-lock')).not.toBeInTheDocument()
  })

  it('takes both away and says why once a day is ticked', () => {
    show(stateFor({ tier: 1, days: [2] }))
    expect(screen.queryByRole('button', { name: 'Đổi mức' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Huỷ thử thách' })).not.toBeInTheDocument()
    expect(screen.getByTestId('challenge-lock')).toHaveTextContent('Đã khoá mức')
  })

  it('changes the tier through the picker it opens', async () => {
    const state = stateFor({ tier: 1 })
    show(state)
    await userEvent.click(screen.getByRole('button', { name: 'Đổi mức' }))
    await userEvent.click(screen.getByRole('button', { name: /Mức 3/ }))
    expect(state.retier).toHaveBeenCalledWith(3)
  })

  it('will not re-offer the tier already running', async () => {
    show(stateFor({ tier: 2 }))
    await userEvent.click(screen.getByRole('button', { name: 'Đổi mức' }))
    expect(screen.getByRole('button', { name: /Mức 2/ })).toBeDisabled()
  })

  it('asks before abandoning the month', async () => {
    const state = stateFor({ tier: 1 })
    show(state)
    await userEvent.click(screen.getByRole('button', { name: 'Huỷ thử thách' }))
    expect(state.abandon).not.toHaveBeenCalled()

    const confirm = screen.getByText(/Huỷ thử thách tháng này/).closest('div') as HTMLElement
    await userEvent.click(within(confirm).getByRole('button', { name: 'Huỷ thử thách' }))
    expect(state.abandon).toHaveBeenCalled()
  })
})

describe('a month that has ended', () => {
  it('shows the history with nothing to press', () => {
    show(stateFor({ tier: 1, month: 8, days: [1, 2] }), 2026, 8)
    // August has 31 days, so day 1 was 31,000 and day 2 was 30,000.
    expect(screen.getByText('₫ 61.000')).toBeInTheDocument()
    expect(dayCell(1)).toBeDisabled()
    expect(dayCell(2)).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Đổi mức' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('challenge-lock')).not.toBeInTheDocument()
  })
})

describe('when the month cannot be read', () => {
  it('says so and offers a retry instead of an empty picker', async () => {
    // The dangerous shape: a failed read rendering as "no challenge yet" would
    // invite the user to start a month that may already be running.
    const state = stateFor({ tier: null, error: true })
    show(state)
    expect(screen.queryByRole('button', { name: /Mức 1/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    expect(state.reload).toHaveBeenCalled()
  })

  it('shows a placeholder while loading, not a picker', () => {
    show(stateFor({ tier: null, loading: true }))
    expect(screen.getByTestId('challenge-skeleton')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mức 1/ })).not.toBeInTheDocument()
  })
})
