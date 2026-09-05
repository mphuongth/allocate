import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import InflationOutlookCard from '../InflationOutlookCard'
import { goalInflationOutlook, goalInflationLadder, goalRealReturn } from '@/lib/inflation'

// The card is the only place the app talks about purchasing power, so what it
// may and may not claim is the thing under test — not its styling.
//
// It must (a) say both halves of the comparison, because "the target grows" and
// "idle savings shrink" answer different questions; (b) always name the rate it
// assumed and mark it an assumption, since it is not a published figure; and
// (c) show the scenario band, so a single guess is never presented as the
// answer. It must NOT restate progress: that ratio is checkable against the
// ledger and this one is not.

const NOW = new Date('2026-09-05T00:00:00Z')
const outlook = (rate = 4, over: Partial<{ targetAmount: number; currentValue: number; targetDate: string }> = {}) =>
  goalInflationOutlook(
    { targetAmount: 500_000_000, targetDate: '2030-06', currentValue: 320_000_000, ...over },
    rate,
    NOW,
  )!

const renderCard = (props: Partial<React.ComponentProps<typeof InflationOutlookCard>> = {}) =>
  render(
    <InflationOutlookCard
      outlook={outlook()}
      ladder={null}
      realReturn={null}
      targetAmount={500_000_000}
      currentValue={320_000_000}
      targetDate="2030-06"
      isVi={false}
      {...props}
    />,
  )

describe('InflationOutlookCard', () => {
  it('renders nothing when there is no outlook to show', () => {
    const { container } = renderCard({ outlook: null })
    expect(container).toBeEmptyDOMElement()
  })

  it('says what the target costs in future money', () => {
    renderCard()
    // 500M compounded at 4% over 45 months = ~579.2M.
    expect(screen.getByTestId('inflation-target-future')).toHaveTextContent('579.2M ₫')
  })

  it('says what today\'s savings are worth against that horizon', () => {
    renderCard()
    expect(screen.getByTestId('inflation-savings-today')).toHaveTextContent('276.2M ₫')
  })

  it('shows a shortfall that is larger than the nominal one', () => {
    renderCard()
    // Nominal gap is 180M; at 4% the real one is ~259.2M. A card that agreed
    // with the progress bar here would have nothing to say.
    expect(screen.getByTestId('inflation-gap-future')).toHaveTextContent('259.2M ₫')
  })

  it('names the assumed rate rather than presenting the number as fact', () => {
    renderCard()
    const note = screen.getByTestId('inflation-assumption-note')
    expect(note).toHaveTextContent('4%')
    expect(note.textContent?.toLowerCase()).toContain('assum')
  })

  it('carries the whole scenario band, with the rate in force marked', () => {
    renderCard()
    const chips = screen.getAllByTestId(/^inflation-scenario-/)
    expect(chips).toHaveLength(3)
    expect(chips.map(c => c.getAttribute('data-current'))).toEqual(['false', 'true', 'false'])
  })

  it('marks no band entry when the goal runs its own rate', () => {
    // A 9% tuition assumption is off the 3/4/5 band; highlighting the nearest
    // chip would tell the user their goal uses a rate it does not.
    renderCard({ outlook: outlook(9) })
    const chips = screen.getAllByTestId(/^inflation-scenario-/)
    expect(chips.every(c => c.getAttribute('data-current') === 'false')).toBe(true)
    expect(screen.getByTestId('inflation-assumption-note')).toHaveTextContent('9%')
  })

  it('drops the shortfall lines once the goal is already ahead of inflation', () => {
    renderCard({ outlook: outlook(4, { currentValue: 900_000_000 }), currentValue: 900_000_000 })
    expect(screen.queryByTestId('inflation-gap-future')).toBeNull()
    // …but still says what the target will cost, which is why it's ahead.
    expect(screen.getByTestId('inflation-target-future')).toBeInTheDocument()
  })

  it('speaks Vietnamese when the app does', () => {
    renderCard({ isVi: true })
    expect(screen.getByTestId('inflation-assumption-note').textContent).toMatch(/giả định/i)
  })

  it('names the target month so the horizon is never implicit', () => {
    renderCard()
    expect(screen.getByTestId('inflation-target-future').textContent).toMatch(/2030/)
  })
})

// ── No deadline ───────────────────────────────────────────────────────────────
// The commonest goal has a target and no target month. It used to get silence,
// which read as "the feature isn't there" rather than "you haven't told me
// when". The ladder answers without inventing a date.

const ladder = (rate = 4, currentValue = 240_000_000) =>
  goalInflationLadder({ targetAmount: 288_000_000, currentValue }, rate)!

const renderLadder = (props: Partial<React.ComponentProps<typeof InflationOutlookCard>> = {}) =>
  render(
    <InflationOutlookCard
      outlook={null}
      ladder={ladder()}
      realReturn={null}
      targetAmount={288_000_000}
      currentValue={240_000_000}
      targetDate={null}
      isVi={false}
      {...props}
    />,
  )

describe('InflationOutlookCard — no deadline', () => {
  it('prices the target at each horizon instead of going quiet', () => {
    renderLadder()
    const steps = screen.getAllByTestId(/^inflation-ladder-/)
    expect(steps).toHaveLength(4)
    // 288M at 4% over 10 years ≈ 426.3M.
    expect(screen.getByTestId('inflation-ladder-10')).toHaveTextContent('426.3M ₫')
  })

  it('says what a year of standing still costs the balance already saved', () => {
    renderLadder()
    // 240M at 4% loses ~9.2M of purchasing power over twelve months.
    expect(screen.getByTestId('inflation-year-loss')).toHaveTextContent('9.2M ₫')
  })

  it('still names the rate as an assumption', () => {
    renderLadder()
    expect(screen.getByTestId('inflation-assumption-note')).toHaveTextContent('4%')
  })

  it('invites the deadline that would make the answer exact', () => {
    renderLadder()
    expect(screen.getByTestId('inflation-set-deadline')).toBeInTheDocument()
  })

  it('prefers the exact answer whenever a deadline exists', () => {
    // Both shapes can be passed; a named month beats a ladder of guesses.
    renderLadder({ outlook: outlook(), targetDate: '2030-06' })
    expect(screen.getByTestId('inflation-target-future')).toBeInTheDocument()
    expect(screen.queryByTestId('inflation-ladder-10')).toBeNull()
  })

  it('renders nothing when there is neither a deadline nor a target', () => {
    const { container } = renderLadder({ outlook: null, ladder: null })
    expect(container).toBeEmptyDOMElement()
  })

  it('drops the standing-still line for a goal with nothing saved yet', () => {
    renderLadder({ ladder: ladder(4, 0), currentValue: 0 })
    expect(screen.queryByTestId('inflation-year-loss')).toBeNull()
    expect(screen.getByTestId('inflation-ladder-10')).toBeInTheDocument()
  })
})

// ── Real return ───────────────────────────────────────────────────────────────
// The line the user actually asked for: not "what does inflation cost me" but
// "am I ahead or behind, net". It belongs in both registers — it is a per-year
// figure and owes nothing to the horizon.

const realReturn = (rate: number, inflation = 4, unrated = 0) =>
  goalRealReturn(
    [{ value: 240_000_000, interestRate: rate }, ...(unrated ? [{ value: unrated, interestRate: null }] : [])],
    inflation,
  )!

describe('InflationOutlookCard — real return', () => {
  it('reports a gain when the rate outruns inflation', () => {
    renderLadder({ realReturn: realReturn(5.6) })
    const line = screen.getByTestId('inflation-real-return')
    expect(line).toHaveTextContent('+1.54%')
    expect(line).toHaveAttribute('data-sign', 'positive')
  })

  it('reports a loss when it does not', () => {
    renderLadder({ realReturn: realReturn(3, 4.45) })
    const line = screen.getByTestId('inflation-real-return')
    expect(line).toHaveAttribute('data-sign', 'negative')
    expect(line.textContent).toMatch(/-1\.3\d%/)
  })

  it('shows both halves of the sum, so the net is checkable', () => {
    renderLadder({ realReturn: realReturn(5.6) })
    const line = screen.getByTestId('inflation-real-return')
    expect(line.textContent).toMatch(/5\.6%/)
    expect(line.textContent).toMatch(/4%/)
  })

  it('replaces the standing-still line, which is false for money that earns', () => {
    renderLadder({ realReturn: realReturn(5.6) })
    expect(screen.queryByTestId('inflation-year-loss')).toBeNull()
  })

  it('keeps the standing-still line when nothing states a rate', () => {
    renderLadder({ realReturn: null })
    expect(screen.getByTestId('inflation-year-loss')).toBeInTheDocument()
  })

  it('says what the answer does not cover', () => {
    renderLadder({ realReturn: realReturn(5.6, 4, 60_000_000) })
    expect(screen.getByTestId('inflation-real-return-scope')).toHaveTextContent('60.0M ₫')
  })

  it('claims no scope caveat when every holding states a rate', () => {
    renderLadder({ realReturn: realReturn(5.6) })
    expect(screen.queryByTestId('inflation-real-return-scope')).toBeNull()
  })

  it('appears on the exact card too — the net owes nothing to the horizon', () => {
    renderCard({ realReturn: realReturn(5.6) })
    expect(screen.getByTestId('inflation-real-return')).toBeInTheDocument()
    expect(screen.getByTestId('inflation-target-future')).toBeInTheDocument()
  })
})
