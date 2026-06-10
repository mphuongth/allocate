import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DesktopPlanningView from '../DesktopPlanningView'
import type { MonthlyPlan, FundInvestment, DirectSaving, RecurringSaving } from '../../PlanningClient'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  useLocale: () => 'en',
}))

vi.mock('@/lib/formatters', () => ({
  fmt: (n: number) => `₫ ${n}`,
  fmtCompact: (n: number) => {
    const abs = Math.abs(n)
    const sign = n < 0 ? '-' : ''
    if (abs >= 1_000_000_000) return sign + (abs / 1_000_000_000).toFixed(1) + 'B ₫'
    if (abs >= 1_000_000) return sign + (abs / 1_000_000).toFixed(1) + 'M ₫'
    return `₫ ${n}`
  },
}))

const basePlan: MonthlyPlan = { id: 'plan-1', month: 5, year: 2026, salary_vnd: 45_000_000 }

const recurringSavings: RecurringSaving[] = [
  {
    saving_id: 'rs1',
    name: 'VCB Savings',
    goal_id: 'g1',
    amount_vnd: 2_000_000,
    effective_from: null,
    effective_to: null,
    savings_goals: { goal_name: 'Retirement' },
  },
]

const defaultProps = {
  month: 5,
  year: 2026,
  plan: null as MonthlyPlan | null,
  investments: [] as FundInvestment[],
  savings: [] as DirectSaving[],
  fixedExpenses: [],
  insuranceMembers: [],
  otherExpenses: [],
  recurringSavings: [] as RecurringSaving[],
  recurringSavingOverrides: [],
  dcaSkips: [],
  funds: [],
  goals: [],
  loading: false,
  onPrev: vi.fn(),
  onNext: vi.fn(),
  onToday: vi.fn(),
  onPlanCreated: vi.fn(),
  onPlanDeleted: vi.fn(),
  onRefresh: vi.fn(),
  onToast: vi.fn(),
}

describe('DesktopPlanningView — goal header "+" log contribution', () => {
  it('renders a Log contribution button on each goal header', () => {
    render(<DesktopPlanningView {...defaultProps} plan={basePlan} recurringSavings={recurringSavings} />)
    expect(screen.getByRole('button', { name: /Log contribution/i })).toBeInTheDocument()
  })

  it('opens the Add-Transaction sheet when the goal "+" is clicked', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(String(url).includes('savings-goals') ? { goals: [] } : []),
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    try {
      render(<DesktopPlanningView {...defaultProps} plan={basePlan} recurringSavings={recurringSavings} />)
      await userEvent.click(screen.getByRole('button', { name: /Log contribution/i }))
      // The canonical sheet exposes the asset-type picker (Fund / Bank / Gold).
      expect(await screen.findByText('Gold')).toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('DesktopPlanningView — recurring bank "Saved" deposit', () => {
  it('renders a Saved button on a recurring bank saving row', () => {
    render(<DesktopPlanningView {...defaultProps} plan={basePlan} recurringSavings={recurringSavings} />)
    expect(screen.getByText('VCB Savings')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Record deposit/i })).toBeInTheDocument()
  })

  it('does not render a Saved button on a skipped recurring saving', () => {
    render(
      <DesktopPlanningView
        {...defaultProps}
        plan={basePlan}
        recurringSavings={recurringSavings}
        recurringSavingOverrides={[{ recurring_saving_id: 'rs1', monthly_amount_override_vnd: 0 }]}
      />,
    )
    expect(screen.queryByRole('button', { name: /Record deposit/i })).not.toBeInTheDocument()
  })

  it('opens the Add-Transaction sheet when Saved is clicked', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(String(url).includes('savings-goals') ? { goals: [] } : []),
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    try {
      render(<DesktopPlanningView {...defaultProps} plan={basePlan} recurringSavings={recurringSavings} />)
      await userEvent.click(screen.getByRole('button', { name: /Record deposit/i }))
      expect(await screen.findByText('Gold')).toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
