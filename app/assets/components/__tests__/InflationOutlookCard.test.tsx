import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import InflationOutlookCard from '../InflationOutlookCard'
import { goalInflationOutlook } from '@/lib/inflation'

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
