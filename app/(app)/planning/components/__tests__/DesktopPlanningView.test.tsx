import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DesktopPlanningView from '../DesktopPlanningView'
import type { MonthlyPlan, FundInvestment, DirectSaving, RecurringSaving, RecurringFulfillment, InsuranceMember } from '../../PlanningClient'

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

  it('combine: records the line AND fills the goal progress from a fulfillment alone — no deposit', () => {
    // Regression: recording via maturity-combine writes a recurring_saving_fulfillments
    // row, not a plan-scoped deposit. The Plan page used to ignore fulfillments and
    // matched only on goal+amount, so the line stayed "Record deposit" AND the goal
    // progress bar showed 0% / "Nothing yet" forever.
    render(
      <DesktopPlanningView
        {...defaultProps}
        plan={basePlan}
        recurringSavings={recurringSavings}
        recurringFulfillments={[{ recurring_saving_id: 'rs1', amount_vnd: 2_000_000, source: 'maturity-combine' }]}
      />,
    )
    // The line is recorded → the prominent Record deposit pill is gone, even with
    // zero logged deposits this month.
    expect(screen.queryByRole('button', { name: /Record deposit/i })).not.toBeInTheDocument()
    // And the goal progress reflects the fulfilled 2M of 2M planned → 100%.
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.queryByText(/Nothing yet/i)).not.toBeInTheDocument()
  })

  it('book top-up: records the line without double-counting the tranche in contributed', () => {
    // The top-up RPC logs a plan-scoped bank tranche (in `savings`) AND a
    // fulfillment (source 'recurring-topup'). contributed must count it once.
    const savings: DirectSaving[] = [
      {
        transaction_id: 'd1', plan_id: 'plan-1', goal_id: 'g1', amount_vnd: 2_000_000,
        interest_rate: null, expiry_date: null, investment_date: '2026-05-10',
        savings_goals: { goal_name: 'Retirement' },
      },
    ]
    render(
      <DesktopPlanningView
        {...defaultProps}
        plan={basePlan}
        recurringSavings={recurringSavings}
        savings={savings}
        recurringFulfillments={[{ recurring_saving_id: 'rs1', amount_vnd: 2_000_000, source: 'recurring-topup' }]}
      />,
    )
    expect(screen.queryByRole('button', { name: /Record deposit/i })).not.toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
    // Counted once (₫ 2000000), not doubled to ₫ 4000000.
    expect(screen.getByText(/₫ 2000000 in/)).toBeInTheDocument()
    expect(screen.queryByText(/₫ 4000000/)).not.toBeInTheDocument()
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

describe('DesktopPlanningView — allocation card amounts never wrap', () => {
  it('keeps the total, remaining and per-row pct on one line so the ₫ never drops under a fallback font', () => {
    render(<DesktopPlanningView {...defaultProps} plan={basePlan} recurringSavings={recurringSavings} />)
    const card = screen.getByTestId('planning-alloc-card')
    // Big total (2.0M ₫) and the matching category row — "M" and "₫" must not split.
    within(card).getAllByText('2.0M ₫').forEach((el) => expect(el).toHaveStyle({ whiteSpace: 'nowrap' }))
    // Remaining value (+43.0M ₫).
    expect(within(card).getByText('+43.0M ₫')).toHaveStyle({ whiteSpace: 'nowrap' })
    // Per-row percentage chip.
    expect(within(card).getByText('4%', { exact: true })).toHaveStyle({ whiteSpace: 'nowrap' })
  })
})

describe('DesktopPlanningView — insurance Relationship + Default columns', () => {
  // 14,000,000 / 12 = 1,166,667 — the default monthly contribution.
  const insuranceMembers: InsuranceMember[] = [
    { member_id: 'i1', member_name: 'John', relationship: 'Spouse', annual_payment_vnd: 14_000_000, payment_date: null },
  ]

  it('renders the Relationship and Default column headers', () => {
    render(<DesktopPlanningView {...defaultProps} plan={basePlan} insuranceMembers={insuranceMembers} />)
    expect(screen.getByText('Relationship')).toBeInTheDocument()
    expect(screen.getByText('Default')).toBeInTheDocument()
  })

  it('shows the member relationship label', () => {
    render(<DesktopPlanningView {...defaultProps} plan={basePlan} insuranceMembers={insuranceMembers} />)
    expect(screen.getByText('Spouse')).toBeInTheDocument()
  })

  it('shows the default monthly amount (annual ÷ 12) alongside this month', () => {
    render(<DesktopPlanningView {...defaultProps} plan={basePlan} insuranceMembers={insuranceMembers} />)
    // Default column + This-month column both show 1,166,667 when not overridden.
    expect(screen.getAllByText('₫ 1166667').length).toBeGreaterThan(0)
  })
})
