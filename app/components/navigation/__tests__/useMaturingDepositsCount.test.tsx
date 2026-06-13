import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { useMaturingDepositsCount } from '../useMaturingDepositsCount'
import { MATURING_COUNT_EVENT } from '@/lib/maturity'

function daysFromNow(n: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function Probe() {
  return <span data-testid="count">{useMaturingDepositsCount()}</span>
}

afterEach(() => vi.restoreAllMocks())

describe('useMaturingDepositsCount', () => {
  it('tracks the dashboard live-count event so it never desyncs from the card', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ goals: [], unallocated: { nonFunds: [] } }) }))
    render(<Probe />)
    expect(screen.getByTestId('count').textContent).toBe('0')

    // Dashboard publishes a live count (e.g. 3 deposits need attention).
    act(() => { window.dispatchEvent(new CustomEvent(MATURING_COUNT_EVENT, { detail: 3 })) })
    expect(screen.getByTestId('count').textContent).toBe('3')

    // After a renewal the dashboard republishes — badge drops in lockstep.
    act(() => { window.dispatchEvent(new CustomEvent(MATURING_COUNT_EVENT, { detail: 2 })) })
    expect(screen.getByTestId('count').textContent).toBe('2')
  })

  it('falls back to the overview fetch on pages where the dashboard is not mounted', async () => {
    const data = {
      goals: [{ nonFunds: [{ type: 'bank', interestRate: 6, expiryDate: daysFromNow(-1) }] }],
      unallocated: { nonFunds: [{ type: 'bank', interestRate: 6, expiryDate: daysFromNow(0) }] },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => data }))
    render(<Probe />)
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'))
  })

  it('does not let a slow fallback fetch overwrite a live count', async () => {
    let resolveFetch: (v: unknown) => void = () => {}
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise((res) => { resolveFetch = res })))
    render(<Probe />)

    // Live event arrives first.
    act(() => { window.dispatchEvent(new CustomEvent(MATURING_COUNT_EVENT, { detail: 5 })) })
    expect(screen.getByTestId('count').textContent).toBe('5')

    // The fetch resolves later with a staler (empty) snapshot — must be ignored.
    await act(async () => {
      resolveFetch({ ok: true, json: async () => ({ goals: [], unallocated: { nonFunds: [] } }) })
    })
    expect(screen.getByTestId('count').textContent).toBe('5')
  })
})
