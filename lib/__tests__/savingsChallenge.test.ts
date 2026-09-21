import { describe, it, expect } from 'vitest'
import {
  CHALLENGE_UNITS_VND,
  isChallengeUnitVnd,
  daysInBusinessMonth,
  challengeDayAmount,
  challengeSchedule,
  challengeTotalVnd,
  challengeMonthState,
} from '@/lib/savingsChallenge'

// The instant every "today" in this file is pinned to: 16 September 2026,
// 00:30 UTC — which is 07:30 on the 16th in Vietnam. Deliberately inside the
// 00:00–06:59 UTC window that #591 was about, so a helper that derived the day
// from UTC would read the 15th and every "up to today" assertion below would
// come out one day short.
const NOW = new Date('2026-09-16T00:30:00Z')

describe('the steps a month can be run at', () => {
  it('are 1,000 through 10,000, in thousands', () => {
    expect(CHALLENGE_UNITS_VND).toEqual([
      1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000,
    ])
  })

  it('recognise their own, and nothing else', () => {
    expect(isChallengeUnitVnd(1000)).toBe(true)
    expect(isChallengeUnitVnd(10000)).toBe(true)
    // Off the grid, off the ends, and not a number at all — each one is a value
    // the database's own CHECK would refuse, caught here so it comes back as a
    // 400 rather than a 500.
    expect(isChallengeUnitVnd(2500)).toBe(false)
    expect(isChallengeUnitVnd(0)).toBe(false)
    expect(isChallengeUnitVnd(11000)).toBe(false)
    expect(isChallengeUnitVnd(-1000)).toBe(false)
    expect(isChallengeUnitVnd('2000')).toBe(false)
    expect(isChallengeUnitVnd(null)).toBe(false)
    expect(isChallengeUnitVnd(undefined)).toBe(false)
  })
})

describe('the length of a month', () => {
  it('reads the calendar, including February', () => {
    expect(daysInBusinessMonth(2026, 9)).toBe(30)
    expect(daysInBusinessMonth(2026, 10)).toBe(31)
    expect(daysInBusinessMonth(2026, 2)).toBe(28)
    expect(daysInBusinessMonth(2028, 2)).toBe(29)   // leap year
    expect(daysInBusinessMonth(2100, 2)).toBe(28)   // century, not a leap year
    expect(daysInBusinessMonth(2000, 2)).toBe(29)   // 400-year exception
    expect(daysInBusinessMonth(2026, 12)).toBe(31)  // rolls the year, not into month 13
    expect(daysInBusinessMonth(2026, 1)).toBe(31)
  })
})

describe('the schedule, run backwards', () => {
  it('asks the most on the 1st and the least on the last day', () => {
    // The smallest step, a 30-day month.
    expect(challengeDayAmount(2026, 9, 1000, 1)).toBe(30_000)
    expect(challengeDayAmount(2026, 9, 1000, 2)).toBe(29_000)
    expect(challengeDayAmount(2026, 9, 1000, 29)).toBe(2_000)
    expect(challengeDayAmount(2026, 9, 1000, 30)).toBe(1_000)
  })

  it('scales by the chosen step, including the ones the tiers skipped', () => {
    expect(challengeDayAmount(2026, 9, 5000, 1)).toBe(150_000)
    expect(challengeDayAmount(2026, 9, 10000, 1)).toBe(300_000)
    expect(challengeDayAmount(2026, 9, 10000, 30)).toBe(10_000)
    // 3,000 and 7,000 had no tier to stand on before — the whole point of the
    // change is that the middle of the range is now reachable.
    expect(challengeDayAmount(2026, 9, 3000, 1)).toBe(90_000)
    expect(challengeDayAmount(2026, 9, 3000, 30)).toBe(3_000)
    expect(challengeDayAmount(2026, 9, 7000, 15)).toBe(112_000)
  })

  it('opens higher in a long month and lower in a short one', () => {
    // A fixed 30-row table would cap October a day short and invent a 29th and
    // 30th of February.
    expect(challengeDayAmount(2026, 10, 1000, 1)).toBe(31_000)
    expect(challengeDayAmount(2026, 10, 1000, 31)).toBe(1_000)
    expect(challengeDayAmount(2027, 2, 1000, 1)).toBe(28_000)
    expect(challengeDayAmount(2027, 2, 1000, 28)).toBe(1_000)
  })

  it('has nothing to say about a day the month does not have', () => {
    expect(challengeDayAmount(2026, 9, 1000, 31)).toBe(0)
    expect(challengeDayAmount(2027, 2, 1000, 29)).toBe(0)
    expect(challengeDayAmount(2026, 9, 1000, 0)).toBe(0)
    expect(challengeDayAmount(2026, 9, 1000, -3)).toBe(0)
    expect(challengeDayAmount(2026, 9, 1000, 1.5)).toBe(0)
  })

  it('lays the month out one row per real day', () => {
    const sep = challengeSchedule(2026, 9, 1000)
    expect(sep).toHaveLength(30)
    expect(sep[0]).toEqual({ day: 1, amountVnd: 30_000 })
    expect(sep[29]).toEqual({ day: 30, amountVnd: 1_000 })

    expect(challengeSchedule(2026, 10, 1000)).toHaveLength(31)
    expect(challengeSchedule(2027, 2, 1000)).toHaveLength(28)
  })

  it('totals the same either way round', () => {
    // 1 + 2 + ... + 30 = 465 steps. Reversing the order cannot change the sum —
    // that is exactly why front-loading it costs the user nothing.
    expect(challengeTotalVnd(2026, 9, 1000)).toBe(465_000)
    expect(challengeTotalVnd(2026, 9, 5000)).toBe(2_325_000)
    expect(challengeTotalVnd(2026, 9, 10000)).toBe(4_650_000)

    // ...and a longer month really does ask for more.
    expect(challengeTotalVnd(2026, 10, 1000)).toBe(496_000)
    expect(challengeTotalVnd(2027, 2, 1000)).toBe(406_000)

    for (const unitVnd of CHALLENGE_UNITS_VND) {
      const schedule = challengeSchedule(2026, 10, unitVnd)
      const summed = schedule.reduce((acc, row) => acc + row.amountVnd, 0)
      expect(challengeTotalVnd(2026, 10, unitVnd)).toBe(summed)
    }
  })
})

describe('where a month stands', () => {
  const state = (over: Partial<Parameters<typeof challengeMonthState>[0]> = {}) =>
    challengeMonthState({ year: 2026, month: 9, unitVnd: 1000, checkedDays: [], now: NOW, ...over })

  it('counts what has been set aside against the whole month', () => {
    const s = state({ checkedDays: [1, 2, 30] })
    expect(s.savedVnd).toBe(30_000 + 29_000 + 1_000)
    expect(s.targetVnd).toBe(465_000)
    expect(s.checkedCount).toBe(3)
    expect(s.totalDays).toBe(30)
  })

  it('reports progress as a bounded percentage', () => {
    expect(state().pct).toBe(0)
    expect(state({ checkedDays: [1] }).pct).toBeCloseTo(6.45, 2)
    expect(state({ checkedDays: challengeSchedule(2026, 9, 1000).map(r => r.day) }).pct).toBe(100)
  })

  it('ignores a day that is not in the month, and counts a repeat once', () => {
    // Defence against whatever the server hands back, not against the DB —
    // which refuses both. A view model that trusted the list would overstate
    // the total, and overstating savings is the one direction that matters.
    const s = state({ checkedDays: [1, 1, 31, 0, -2] })
    expect(s.savedVnd).toBe(30_000)
    expect(s.checkedCount).toBe(1)
  })

  it('knows today, and what today asks for', () => {
    const s = state()
    expect(s.isCurrentMonth).toBe(true)
    expect(s.today).toBe(16)
    expect(s.todayAmountVnd).toBe(15_000)  // (30 + 1 - 16) x 1,000
    expect(s.todayChecked).toBe(false)
    expect(state({ checkedDays: [16] }).todayChecked).toBe(true)
  })

  it('measures the backlog against the days that have actually passed', () => {
    // Days 1..16 are due by the 16th: 30 + 29 + ... + 15 = 360 steps.
    const s = state({ checkedDays: [1, 2] })
    expect(s.dueVnd).toBe(360_000)
    expect(s.behindVnd).toBe(360_000 - 59_000)

    // Ticking every past day clears it; nothing pushes it negative.
    const caughtUp = state({ checkedDays: Array.from({ length: 16 }, (_, i) => i + 1) })
    expect(caughtUp.behindVnd).toBe(0)
  })

  it('lets a past day be ticked, and refuses a future one', () => {
    const s = state()
    expect(s.canTick(1)).toBe(true)
    expect(s.canTick(16)).toBe(true)
    expect(s.canTick(17)).toBe(false)
    expect(s.canTick(30)).toBe(false)
    expect(s.canTick(31)).toBe(false)
  })

  it('closes a month that has gone by — it is history, not a to-do list', () => {
    const past = state({ month: 8 })
    expect(past.isCurrentMonth).toBe(false)
    expect(past.today).toBeNull()
    expect(past.todayAmountVnd).toBe(0)
    expect(past.canTick(1)).toBe(false)
    expect(past.canTick(31)).toBe(false)
    // Its whole month is what was due, so the shortfall is the honest total.
    expect(past.dueVnd).toBe(challengeTotalVnd(2026, 8, 1000))

    const lastYear = state({ year: 2025, month: 9 })
    expect(lastYear.isCurrentMonth).toBe(false)
  })

  it('opens no month early either', () => {
    const ahead = state({ month: 10 })
    expect(ahead.isCurrentMonth).toBe(false)
    expect(ahead.canTick(1)).toBe(false)
    // Nothing is due in a month that has not started, so nothing is behind.
    expect(ahead.dueVnd).toBe(0)
    expect(ahead.behindVnd).toBe(0)
  })

  it('reads today in Vietnam, not in UTC', () => {
    // 23:30 UTC on the 15th is already 06:30 on the 16th in Vietnam, and 00:30
    // UTC on the 16th still is. Both must answer 16 — the first would read 15
    // from a UTC date, the second from a US-local one.
    expect(state({ now: new Date('2026-09-15T23:30:00Z') }).today).toBe(16)
    expect(state({ now: new Date('2026-09-16T00:30:00Z') }).today).toBe(16)
    // ...and the last hour of the 15th in Vietnam is still the 15th.
    expect(state({ now: new Date('2026-09-15T16:30:00Z') }).today).toBe(15)
  })

  it('answers for a month with no challenge at all', () => {
    const none = challengeMonthState({ year: 2026, month: 9, unitVnd: null, checkedDays: [], now: NOW })
    expect(none.targetVnd).toBe(0)
    expect(none.savedVnd).toBe(0)
    expect(none.dueVnd).toBe(0)
    expect(none.behindVnd).toBe(0)
    expect(none.pct).toBe(0)
    expect(none.todayAmountVnd).toBe(0)
    expect(none.schedule).toEqual([])
    // The month itself is still the current one — that is what lets the UI
    // offer the pick rather than the history.
    expect(none.isCurrentMonth).toBe(true)
    expect(none.canTick(1)).toBe(false)
  })
})

describe('the lock', () => {
  it('holds a step as soon as one day is ticked, and lets go when none is', () => {
    // The mirror of the database trigger, so the UI can grey the control out
    // instead of letting the user press it and read a refusal.
    const at = (checkedDays: number[]) =>
      challengeMonthState({ year: 2026, month: 9, unitVnd: 1000, checkedDays, now: NOW }).locked
    expect(at([])).toBe(false)
    expect(at([4])).toBe(true)
    // A day the month does not have is not a tick, here as everywhere else.
    expect(at([31])).toBe(false)
  })
})
