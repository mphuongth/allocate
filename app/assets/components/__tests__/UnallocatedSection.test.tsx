import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import UnallocatedSection from '../UnallocatedSection'
import { SUCCESS_FLASH_MS } from '../../successFlash'

// Resolve real English copy from the catalog so the assertion checks rendered text.
vi.mock('next-intl', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const en = require('../../../../messages/en.json')
  const resolve = (ns: string | undefined, key: string) => {
    const dict = ns ? en[ns] : en
    return key.split('.').reduce((o: Record<string, unknown> | undefined, k: string) =>
      (o == null ? undefined : o[k] as Record<string, unknown>), dict) ?? key
  }
  return {
    useTranslations: (ns?: string) => (key: string) => resolve(ns, key),
    useLocale: () => 'en',
  }
})

const baseProps = {
  unallocatedAmount: 9_000_000,
  funds: [],
  nonFunds: [],
  onFundClick: vi.fn(),
  onAssignToGoal: vi.fn(),
  onSellFund: vi.fn(),
  onAssignNonFundToGoal: vi.fn(),
  onSellNonFund: vi.fn(),
}

describe('UnallocatedSection — explains what "Unallocated" means', () => {
  it('shows a one-line hint when the section is expanded (mobile)', () => {
    render(<UnallocatedSection {...baseProps} />)
    expect(screen.getByText(/not yet linked to a goal/i)).toBeInTheDocument()
  })

  it('shows the hint in the desktop card too', () => {
    render(<UnallocatedSection {...baseProps} desktopCard />)
    expect(screen.getByText(/not yet linked to a goal/i)).toBeInTheDocument()
  })
})

// The success flash and the dashboard refresh used to be two independent timers
// of the same duration, one owned here and one owned by DashboardClient. The
// refresh drops the now-assigned row, which unmounts this section — so it could
// tear the success state down before it had been shown for its full duration
// (#567). One owner, one timer: this component ends the flash and asks for the
// refresh in the same tick.
describe('UnallocatedSection — desktop assign success flash', () => {
  const item = {
    transactionId: 'tx-1',
    type: 'bank',
    amount: 5_000_000,
    currentValue: 5_200_000,
    interestRate: 6,
    expiryDate: null,
    investmentDate: '2026-01-01',
    notes: 'Term deposit',
    units: null,
  }

  const goalsResponse = {
    goals: [{ goal_id: 'goal-1', goal_name: 'House Fund', current_value: 0, target_amount: 100_000_000, progress_percentage: 0 }],
  }

  // `findBy*` polls on timers, which are faked here, so the flow is driven with
  // explicit microtask flushes instead.
  const flush = () => act(async () => { await Promise.resolve() })

  // `fireEvent` rather than `userEvent`: userEvent's own internal delays run on
  // the timers this suite fakes, and it never settles.
  async function openAssignFlow(props: Partial<React.ComponentProps<typeof UnallocatedSection>> = {}) {
    const view = render(<UnallocatedSection {...baseProps} nonFunds={[item]} desktopCard {...props} />)

    fireEvent.click(screen.getByTestId('unallocated-row'))
    fireEvent.click(screen.getByTestId('action-assign'))
    await flush() // goals fetch resolves
    fireEvent.click(screen.getByText('House Fund'))
    fireEvent.click(screen.getByRole('button', { name: /confirm assignment/i }))
    await flush() // assignment resolves, success state renders
    return view
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => goalsResponse })))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('does not ask for the refresh until the success flash has run', async () => {
    const onAssigned = vi.fn()
    await openAssignFlow({ onDesktopAssign: vi.fn(async () => {}), onDesktopAssigned: onAssigned })

    expect(screen.getByText(/assigned to/i)).toBeInTheDocument()
    expect(onAssigned).not.toHaveBeenCalled()

    await act(async () => { vi.advanceTimersByTime(SUCCESS_FLASH_MS - 1) })
    expect(screen.getByText(/assigned to/i)).toBeInTheDocument()
    expect(onAssigned).not.toHaveBeenCalled()
  })

  it('ends the flash and asks for the refresh in the same tick', async () => {
    const onAssigned = vi.fn()
    await openAssignFlow({ onDesktopAssign: vi.fn(async () => {}), onDesktopAssigned: onAssigned })
    expect(screen.getByText(/assigned to/i)).toBeInTheDocument()

    await act(async () => { vi.advanceTimersByTime(SUCCESS_FLASH_MS) })

    expect(screen.queryByText(/assigned to/i)).not.toBeInTheDocument()
    expect(onAssigned).toHaveBeenCalledTimes(1)
  })

  it('leaves the modal open on failure, with no refresh', async () => {
    const onAssigned = vi.fn()
    await openAssignFlow({
      onDesktopAssign: vi.fn(async () => { throw new Error('Failed to assign') }),
      onDesktopAssigned: onAssigned,
    })

    expect(screen.getByText(/failed to assign/i)).toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(SUCCESS_FLASH_MS * 2) })
    expect(onAssigned).not.toHaveBeenCalled()
  })

  // Crossing the 768px breakpoint mid-flash swaps DashboardClient's desktop tree
  // for the mobile one and unmounts this section. The assignment has already
  // been written by then, so cancelling the refresh would leave the other layout
  // rendering the item as unallocated — the flash is what gets abandoned, not
  // the refresh.
  it('still asks for the refresh when the section unmounts mid-flash', async () => {
    const onAssigned = vi.fn()
    const { unmount } = await openAssignFlow({
      onDesktopAssign: vi.fn(async () => {}),
      onDesktopAssigned: onAssigned,
    })
    expect(screen.getByText(/assigned to/i)).toBeInTheDocument()

    await act(async () => { unmount() })

    expect(onAssigned).toHaveBeenCalledTimes(1)
  })

  it('leaves no pending timer behind after unmounting mid-flash', async () => {
    const onAssigned = vi.fn()
    const { unmount } = await openAssignFlow({
      onDesktopAssign: vi.fn(async () => {}),
      onDesktopAssigned: onAssigned,
    })
    await act(async () => { unmount() })

    await act(async () => { vi.advanceTimersByTime(SUCCESS_FLASH_MS * 2) })

    expect(onAssigned).toHaveBeenCalledTimes(1)
  })

  it('does not ask for a refresh when nothing was assigned', async () => {
    const onAssigned = vi.fn()
    const { unmount } = render(
      <UnallocatedSection {...baseProps} nonFunds={[item]} desktopCard
        onDesktopAssign={vi.fn(async () => {})} onDesktopAssigned={onAssigned} />
    )

    await act(async () => { unmount() })

    expect(onAssigned).not.toHaveBeenCalled()
  })
})
