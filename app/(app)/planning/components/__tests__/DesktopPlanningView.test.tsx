import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DesktopPlanningView from '../DesktopPlanningView'
import type { MonthlyPlan, FundInvestment, DirectSaving, RecurringSaving, RecurringFulfillment } from '../../PlanningClient'

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
  recurringFulfillments: [] as RecurringFulfillment[],
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

  it('shows the recurring saving as done (no Record deposit button) once a matching deposit is logged, and fills the goal progress', () => {
    const savings: DirectSaving[] = [
      {
        transaction_id: 'd1', plan_id: 'plan-1', goal_id: 'g1', amount_vnd: 2_000_000,
        interest_rate: null, expiry_date: null, investment_date: '2026-05-10',
        savings_goals: { goal_name: 'Retirement' },
      },
    ]
    render(<DesktopPlanningView {...defaultProps} plan={basePlan} recurringSavings={recurringSavings} savings={savings} />)
    // The line is recorded → the prominent Record deposit pill is gone.
    expect(screen.queryByRole('button', { name: /Record deposit/i })).not.toBeInTheDocument()
    // The goal progress reflects the logged contribution (2M of 2M planned).
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('records the line AND fills the goal progress from a fulfillment alone — no deposit (maturity-combine / book top-up)', () => {
    // Regression: recording via maturity-combine writes a recurring_saving_fulfillments
    // row, not a plan-scoped deposit. The Plan page used to ignore fulfillments and
    // matched only on goal+amount, so the line stayed "Record deposit" AND the goal
    // progress bar showed 0% / "Nothing yet" forever.
    render(
      <DesktopPlanningView
        {...defaultProps}
        plan={basePlan}
        recurringSavings={recurringSavings}
        recurringFulfillments={[{ recurring_saving_id: 'rs1', amount_vnd: 2_000_000 }]}
      />,
    )
    // The line is recorded → the prominent Record deposit pill is gone, even with
    // zero logged deposits this month.
    expect(screen.queryByRole('button', { name: /Record deposit/i })).not.toBeInTheDocument()
    // And the goal progress reflects the fulfilled 2M of 2M planned → 100%.
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.queryByText(/Nothing yet/i)).not.toBeInTheDocument()
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
