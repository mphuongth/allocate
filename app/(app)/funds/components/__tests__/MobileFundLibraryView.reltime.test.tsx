import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import MobileFundLibraryView from '../MobileFundLibraryView'
import type { Fund } from '../useFundsData'
import { useFundsBusy } from './helpers/fundsBusy'

// Same translation mock as the DCA suite — params are echoed as JSON so the
// relative-time bucket (relMinutes/relHours/…) is observable in the DOM:
//   t('updatedAgo', { time: 'relMinutes:{"m":5}' }) → updatedAgo:{"time":"relMinutes:{"m":5}"}
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  useLocale: () => 'en',
}))

vi.mock('@/lib/formatters', () => ({
  fmtNav: (n: number) => String(n),
  fmtCompact: (n: number) => `${n}`,
}))

vi.mock('@/app/components/navigation/NavigationContext', () => ({
  useNavigation: () => ({ setMobileTopBar: vi.fn() }),
}))

function makeFund(over: Partial<Fund> = {}): Fund {
  return {
    id: 'f1',
    name: 'VFMVF1 Equity Fund',
    code: 'VFMVF1',
    fund_type: 'equity',
    nav: 36120,
    nav_source_url: null,
    is_dca: false,
    dca_monthly_amount_vnd: null,
    dca_goal_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  }
}

function Harness({ initial, reload }: { initial: Fund[]; reload: () => Promise<void> }) {
  const [funds, setFunds] = useState(initial)
  return (
    <MobileFundLibraryView
      {...useFundsBusy()}
      funds={funds}
      setFunds={setFunds}
      goals={[]}
      loading={false}
      error={false}
      reload={reload}
    />
  )
}

describe('MobileFundLibraryView — relative NAV-age label must not jump across re-renders', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  // The old implementation called Date.now() *inside render* via relDate(), so a
  // parent re-render (with the clock advanced) recomputed the bucket with the new
  // "now" → the "Updated Xm ago" line drifted even though updated_at was unchanged.
  // After moving the computation into an effect memoized on updated_at, the label
  // is pinned to the value from the first render and stays steady on re-render.
  it('keeps the same relative-age bucket when the parent re-renders with a later clock', () => {
    vi.useFakeTimers()
    const base = new Date('2026-06-30T12:00:00Z').getTime()
    vi.setSystemTime(base)
    // 5 minutes before "now".
    const updatedAt = new Date(base - 5 * 60_000).toISOString()

    const { rerender } = render(
      <Harness initial={[makeFund({ nav_source_url: 'http://example.test', updated_at: updatedAt })]} reload={vi.fn(() => Promise.resolve())} />,
    )

        // Sanity: the card renders the "Updated …" line at all, bucketed as 5m.
    // (Match on the minutes digit via ":N}" so it survives the nested
    // JSON.stringify in the translation mock — the inner quotes get escaped, so a
    // literal '"m":5' substring is NOT present in the rendered text.)
    const line = screen.getByText(/updatedAgo/)
    expect(line.textContent).toContain(':5}')

    // Advance the wall clock 3 minutes and force a re-render with identical props.
    // Before the fix this recomputed with the newer Date.now() → 8m and the test
    // below would fail. After the fix the bucket is memoized on updated_at → 5m.
    vi.setSystemTime(base + 3 * 60_000)
    rerender(
      <Harness initial={[makeFund({ nav_source_url: 'http://example.test', updated_at: updatedAt })]} reload={vi.fn(() => Promise.resolve())} />,
    )

    expect(screen.getByText(/updatedAgo/).textContent).toContain(':5}')
    expect(screen.getByText(/updatedAgo/).textContent).not.toContain(':8}')
  })
})
