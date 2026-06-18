import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MobilePlanningView from '../MobilePlanningView'
import type { MonthlyPlan, FixedExpense, InsuranceMember, OtherExpense, FundInvestment, DirectSaving } from '../../PlanningClient'

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

const basePlan: MonthlyPlan = {
  id: 'plan-1',
  month: 5,
  year: 2026,
  salary_vnd: 45_000_000,
}

const baseFixedExpenses: FixedExpense[] = [
  { expense_id: 'fe1', expense_name: 'Rent', amount_vnd: 8_500_000 },
  { expense_id: 'fe2', expense_name: 'Utilities', amount_vnd: 1_200_000 },
]

const baseInsuranceMembers: InsuranceMember[] = [
  {
    member_id: 'i1',
    member_name: 'John',
    relationship: 'Self',
    annual_payment_vnd: 18_000_000,
    payment_date: null,
  },
]

const baseOtherExpenses: OtherExpense[] = [
  { id: 'o1', plan_id: 'plan-1', description: 'Family trip', amount_vnd: 6_000_000, created_at: '2026-05-01' },
]

const baseInvestments: FundInvestment[] = [
  {
    transaction_id: 'tx1',
    plan_id: 'plan-1',
    fund_id: 'f1',
    goal_id: 'g1',
    amount_vnd: 5_000_000,
    units: null,
    unit_price: null,
    investment_date: '2026-05-01',
    is_dca_seeded: false,
    funds: { name: 'VFMVF1', nav: 36120 },
    savings_goals: { goal_name: 'Retirement' },
  },
]

const baseSavings: DirectSaving[] = [
  {
    transaction_id: 'sv1',
    plan_id: 'plan-1',
    goal_id: 'g2',
    amount_vnd: 3_000_000,
    interest_rate: null,
    expiry_date: null,
    investment_date: '2026-05-01',
    savings_goals: { goal_name: 'Emergency fund' },
  },
]

const defaultProps = {
  month: 5,
  year: 2026,
  plan: null as MonthlyPlan | null,
  investments: [] as FundInvestment[],
  savings: [] as DirectSaving[],
  fixedExpenses: [] as FixedExpense[],
  insuranceMembers: [] as InsuranceMember[],
  otherExpenses: [] as OtherExpense[],
  recurringSavings: [],
  recurringSavingOverrides: [],
  recurringFulfilledIds: [] as string[],
  dcaSkips: [],
  funds: [],
  goals: [],
  onPlanCreated: vi.fn(),
  onPlanDeleted: vi.fn(),
  onRefresh: vi.fn(),
  onToast: vi.fn(),
}

describe('MobilePlanningView — no plan', () => {
  it('shows month label in no-plan state', () => {
    render(<MobilePlanningView {...defaultProps} />)
    expect(screen.getAllByText(/May 2026/).length).toBeGreaterThan(0)
  })

  it('shows "Set income" CTA when plan is null', () => {
    render(<MobilePlanningView {...defaultProps} />)
    expect(screen.getByRole('button', { name: /set income/i })).toBeInTheDocument()
  })

  it('does not show salary card when plan is null', () => {
    render(<MobilePlanningView {...defaultProps} />)
    expect(screen.queryByText(/Monthly income/i)).not.toBeInTheDocument()
  })

  it('opens salary sheet when "Set income" is clicked', async () => {
    render(<MobilePlanningView {...defaultProps} />)
    await userEvent.click(screen.getByRole('button', { name: /set income/i }))
    // Sheet opens with a "Set income" or similar title
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })
})

describe('MobilePlanningView — with plan', () => {
  it('shows salary card with "Monthly income" label', () => {
    render(<MobilePlanningView {...defaultProps} plan={basePlan} />)
    expect(screen.getByText(/Monthly income/i)).toBeInTheDocument()
  })

  it('shows the exact salary in the salary card, not an abbreviated amount', () => {
    render(<MobilePlanningView {...defaultProps} plan={basePlan} />)
    // The salary card renders the income in full (fmt → "₫ 45000000"), not the
    // shortened "45.0M ₫". Scope to the salary card since compact amounts still
    // legitimately appear in the dense allocation card / summary strip.
    const valueEl = screen.getByText(/Monthly income/i).nextElementSibling
    expect(valueEl).toHaveTextContent('₫ 45000000')
    expect(valueEl).not.toHaveTextContent('45.0M')
  })

  it('shows Outflow label in summary strip', () => {
    render(<MobilePlanningView {...defaultProps} plan={basePlan} />)
    expect(screen.getByText(/Outflow/i)).toBeInTheDocument()
  })

  it('shows Remaining label in summary strip', () => {
    render(<MobilePlanningView {...defaultProps} plan={basePlan} />)
    expect(screen.getAllByText(/Remaining/i).length).toBeGreaterThan(0)
  })

  it('shows Saved % label in summary strip', () => {
    render(<MobilePlanningView {...defaultProps} plan={basePlan} />)
    expect(screen.getByText(/Saved %/i)).toBeInTheDocument()
  })

  it("shows allocation summary card with \"This month's allocation\" label", () => {
    render(<MobilePlanningView {...defaultProps} plan={basePlan} />)
    expect(screen.getByText(/This month's allocation/i)).toBeInTheDocument()
  })

  it('shows edit (pencil) and delete (trash) buttons on salary card', () => {
    render(<MobilePlanningView {...defaultProps} plan={basePlan} />)
    expect(screen.getByLabelText(/edit/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/delete/i)).toBeInTheDocument()
  })

  it('opens salary edit sheet when edit button is clicked', async () => {
    render(<MobilePlanningView {...defaultProps} plan={basePlan} />)
    await userEvent.click(screen.getByLabelText(/edit/i))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('opens delete confirmation when delete button is clicked', async () => {
    render(<MobilePlanningView {...defaultProps} plan={basePlan} />)
    await userEvent.click(screen.getByLabelText(/delete/i))
    expect(screen.getByText(/Delete monthly plan/i)).toBeInTheDocument()
  })
})

describe('MobilePlanningView — fixed expenses section', () => {
  it('shows fixed expenses section when expenses exist', () => {
    render(<MobilePlanningView {...defaultProps} plan={basePlan} fixedExpenses={baseFixedExpenses} />)
    expect(screen.getAllByText(/Fixed expenses/i).length).toBeGreaterThan(0)
  })

  it('shows expense names in fixed expenses section', () => {
    render(<MobilePlanningView {...defaultProps} plan={basePlan} fixedExpenses={baseFixedExpenses} />)
    expect(screen.getByText('Rent')).toBeInTheDocument()
    expect(screen.getByText('Utilities')).toBeInTheDocument()
  })

  it('shows "Skipped" for a skipped expense (override === 0)', () => {
    const skippedExpenses: FixedExpense[] = [
      { expense_id: 'fe1', expense_name: 'Gym', amount_vnd: 600_000, override: 0 },
    ]
    render(<MobilePlanningView {...defaultProps} plan={basePlan} fixedExpenses={skippedExpenses} />)
    expect(screen.getByText(/Skipped/i)).toBeInTheDocument()
  })

  it('shows "(overridden)" for an overridden expense', () => {
    const overriddenExpenses: FixedExpense[] = [
      { expense_id: 'fe1', expense_name: 'Rent', amount_vnd: 8_500_000, override: 5_000_000 },
    ]
    render(<MobilePlanningView {...defaultProps} plan={basePlan} fixedExpenses={overriddenExpenses} />)
    expect(screen.getByText(/overridden/i)).toBeInTheDocument()
  })

  it('excludes skipped expenses from section total', () => {
    const expenses: FixedExpense[] = [
      { expense_id: 'fe1', expense_name: 'Rent', amount_vnd: 8_500_000 },
      { expense_id: 'fe2', expense_name: 'Gym', amount_vnd: 600_000, override: 0 },
    ]
    render(<MobilePlanningView {...defaultProps} plan={basePlan} fixedExpenses={expenses} />)
    // Section total should be the exact 8,500,000 only (gym is skipped)
    const section = screen.getByTestId('section-fixed-expenses').closest('[data-testid="budget-section"]')
    if (section) {
      expect(section).toHaveTextContent('₫ 8500000')
      expect(section).not.toHaveTextContent('₫ 9100000') // 8.5M + 0.6M
    }
  })
})

describe('MobilePlanningView — insurance section', () => {
  it('shows insurance section when members exist', () => {
    render(<MobilePlanningView {...defaultProps} plan={basePlan} insuranceMembers={baseInsuranceMembers} />)
    expect(screen.getAllByText('Insurance').length).toBeGreaterThan(0)
  })

  it('shows member name in insurance section', () => {
    render(<MobilePlanningView {...defaultProps} plan={basePlan} insuranceMembers={baseInsuranceMembers} />)
    expect(screen.getByText('John')).toBeInTheDocument()
  })

  it('shows "Skipped" for an excluded insurance member', () => {
    const excludedMembers: InsuranceMember[] = [
      {
        member_id: 'i1',
        member_name: 'John',
        relationship: 'Self',
        annual_payment_vnd: 18_000_000,
        payment_date: null,
        excluded: true,
      },
    ]
    render(<MobilePlanningView {...defaultProps} plan={basePlan} insuranceMembers={excludedMembers} />)
    expect(screen.getByText(/Skipped/i)).toBeInTheDocument()
  })
})

describe('MobilePlanningView — other expenses section', () => {
  it('shows other expenses section', () => {
    render(<MobilePlanningView {...defaultProps} plan={basePlan} otherExpenses={baseOtherExpenses} />)
    expect(screen.getAllByText(/Other/i).length).toBeGreaterThan(0)
    expect(screen.getByText('Family trip')).toBeInTheDocument()
  })

  it('shows "Add item" button in other expenses section', () => {
    render(<MobilePlanningView {...defaultProps} plan={basePlan} />)
    expect(screen.getByRole('button', { name: /Add item/i })).toBeInTheDocument()
  })
})

describe('MobilePlanningView — iOS zoom guard (issue #265)', () => {
  // iOS Safari zooms when a focused native field is < 16px. The "Add item" form
  // (description + amount) must render its inputs at >= 16px.
  it('renders the other-expense form inputs at >=16px', async () => {
    render(<MobilePlanningView {...defaultProps} plan={basePlan} />)
    await userEvent.click(screen.getByRole('button', { name: /Add item/i }))
    const inputs = screen.getAllByRole('textbox')
    expect(inputs.length).toBeGreaterThan(0)
    for (const el of inputs) {
      expect(parseFloat(getComputedStyle(el).fontSize)).toBeGreaterThanOrEqual(16)
    }
  })
})

describe('MobilePlanningView — override sheet rounded corners (issue #319)', () => {
  // The override bottom-sheet animates up with a `transform` (slide-up). On iOS
  // WebKit that composites the layer, and the rounded top corners are only
  // clipped when the card also sets `overflow: hidden` — otherwise the corners
  // render square (issue #319). Assert both the radius and the clip.
  it('gives the override sheet card rounded, clipped top corners', async () => {
    const user = userEvent.setup()
    render(<MobilePlanningView {...defaultProps} plan={basePlan} fixedExpenses={baseFixedExpenses} />)

    await user.click(screen.getAllByLabelText('More options')[0])
    await user.click(screen.getByText('Override amount'))

    const title = await screen.findByText('Override amount', { selector: 'p' })
    const card = title.closest('div')!.parentElement as HTMLElement

    expect(card.style.borderRadius).toBe('16px 16px 0 0')
    expect(card.style.overflow).toBe('hidden')
  })
})

describe('MobilePlanningView — by goal section', () => {
  it('shows investments grouped by goal', () => {
    render(<MobilePlanningView {...defaultProps} plan={basePlan} investments={baseInvestments} savings={baseSavings} />)
    expect(screen.getByText('Retirement')).toBeInTheDocument()
    expect(screen.getByText('Emergency fund')).toBeInTheDocument()
  })

  it('shows "By goal" section header', () => {
    render(<MobilePlanningView {...defaultProps} plan={basePlan} investments={baseInvestments} />)
    expect(screen.getByText(/By goal/i)).toBeInTheDocument()
  })
})

describe('MobilePlanningView — allocation summary with all categories', () => {
  it('shows fixed expenses row in allocation summary when expenses exist', () => {
    render(<MobilePlanningView {...defaultProps} plan={basePlan} fixedExpenses={baseFixedExpenses} />)
    expect(screen.getAllByText(/Fixed expenses/i).length).toBeGreaterThan(0)
  })

  it('shows insurance row in allocation summary when members exist', () => {
    render(<MobilePlanningView {...defaultProps} plan={basePlan} insuranceMembers={baseInsuranceMembers} />)
    expect(screen.getAllByText(/Insurance/i).length).toBeGreaterThan(0)
  })

  it('shows over-budget warning when remaining is negative', () => {
    // salary 1M, fixed expenses 2M → remaining -1M → over budget
    const bigExpenses: FixedExpense[] = [
      { expense_id: 'fe1', expense_name: 'Rent', amount_vnd: 2_000_000 },
    ]
    const smallPlan: MonthlyPlan = { id: 'p2', month: 5, year: 2026, salary_vnd: 1_000_000 }
    render(<MobilePlanningView {...defaultProps} plan={smallPlan} fixedExpenses={bigExpenses} />)
    expect(screen.getByText(/Over budget/i)).toBeInTheDocument()
  })
})

describe('MobilePlanningView — collapsible sections', () => {
  it('fixed expenses section is open by default', () => {
    render(<MobilePlanningView {...defaultProps} plan={basePlan} fixedExpenses={baseFixedExpenses} />)
    // When open, the expense items are visible
    expect(screen.getByText('Rent')).toBeInTheDocument()
  })

  it('toggles fixed expenses section on header click', async () => {
    render(<MobilePlanningView {...defaultProps} plan={basePlan} fixedExpenses={baseFixedExpenses} />)
    // Items are visible initially (section is open)
    expect(screen.getByText('Rent')).toBeInTheDocument()
    // Click the header to collapse
    const sectionBtn = screen.getByTestId('section-fixed-expenses')
    await userEvent.click(sectionBtn)
    // Items should be hidden now
    expect(screen.queryByText('Rent')).not.toBeInTheDocument()
  })
})

describe('MobilePlanningView — recurring savings in By goal', () => {
  const recurringSavings = [
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

  // A planned DCA fund line (seeded, not yet bought) toward Retirement.
  const dcaInvestments: FundInvestment[] = [
    { ...baseInvestments[0], is_dca_seeded: true, units: null },
  ]

  it('renders a recurring saving under its goal and includes it in the planned total', async () => {
    render(
      <MobilePlanningView
        {...defaultProps}
        plan={basePlan}
        investments={dcaInvestments}
        recurringSavings={recurringSavings}
      />,
    )
    // Planned = 5M fund DCA + 2M recurring saving = 7M (full-format),
    // shown in the section header and the goal row.
    expect(screen.getAllByText('₫ 7000000').length).toBeGreaterThan(0)
    // Expand the Retirement goal — recurring saving name becomes visible
    await userEvent.click(screen.getByText('Retirement'))
    expect(screen.getByText('VCB Savings')).toBeInTheDocument()
  })

  it('counts a recorded fund buy as contributed, not just planned', async () => {
    const recorded: FundInvestment[] = [{ ...baseInvestments[0], is_dca_seeded: true, units: 100 }]
    render(<MobilePlanningView {...defaultProps} plan={basePlan} investments={recorded} />)
    // Contributed footer reflects the recorded 5M buy (compact format)
    expect(screen.getByTestId('planning-contributed')).toBeInTheDocument()
    expect(screen.getAllByText(/5\.0M ₫/).length).toBeGreaterThan(0)
  })

  it('shows a skipped recurring saving with a zero effective amount', async () => {
    render(
      <MobilePlanningView
        {...defaultProps}
        plan={basePlan}
        recurringSavings={recurringSavings}
        recurringSavingOverrides={[{ recurring_saving_id: 'rs1', monthly_amount_override_vnd: 0 }]}
      />,
    )
    // Expand the goal — the skipped saving is labelled and struck through
    await userEvent.click(screen.getByText('Retirement'))
    expect(screen.getByText(/Skipped this month/i)).toBeInTheDocument()
  })

  it('exposes a Manage savings action on the By goal section', () => {
    render(<MobilePlanningView {...defaultProps} plan={basePlan} recurringSavings={recurringSavings} />)
    expect(screen.getByTestId('mobile-manage-savings')).toBeInTheDocument()
  })

  it('shows a Buy action on a pending DCA fund line', async () => {
    const pending: FundInvestment[] = [{ ...baseInvestments[0], is_dca_seeded: true, units: null }]
    render(<MobilePlanningView {...defaultProps} plan={basePlan} investments={pending} />)
    await userEvent.click(screen.getByText('Retirement'))
    expect(screen.getByRole('button', { name: /Record buy/i })).toBeInTheDocument()
  })

  it('opens the full Add-Transaction sheet (not the mini popup) when Buy is clicked', async () => {
    // The canonical Add-Transaction sheet fetches funds + goals on open.
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(String(url).includes('savings-goals') ? { goals: [] } : []),
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    try {
      const pending: FundInvestment[] = [{ ...baseInvestments[0], is_dca_seeded: true, units: null }]
      render(<MobilePlanningView {...defaultProps} plan={basePlan} investments={pending} />)
      await userEvent.click(screen.getByText('Retirement'))
      await userEvent.click(screen.getByRole('button', { name: /Record buy/i }))
      // The full sheet exposes the asset-type picker (Fund / Bank / Gold); the
      // old mini popup only had Price-per-unit + Units fields.
      expect(await screen.findByText('Gold')).toBeInTheDocument()
      expect(screen.queryByText(/Price \/ unit/i)).not.toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('renders a Log contribution "+" on the goal header', () => {
    render(<MobilePlanningView {...defaultProps} plan={basePlan} recurringSavings={recurringSavings} />)
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
      render(<MobilePlanningView {...defaultProps} plan={basePlan} recurringSavings={recurringSavings} />)
      await userEvent.click(screen.getByRole('button', { name: /Log contribution/i }))
      expect(await screen.findByText('Gold')).toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('shows a Saved/deposit action on a recurring bank saving', async () => {
    render(<MobilePlanningView {...defaultProps} plan={basePlan} recurringSavings={recurringSavings} />)
    await userEvent.click(screen.getByText('Retirement'))
    expect(screen.getByRole('button', { name: /Record deposit/i })).toBeInTheDocument()
  })

  it('hides the Saved action on a skipped recurring saving', async () => {
    render(
      <MobilePlanningView
        {...defaultProps}
        plan={basePlan}
        recurringSavings={recurringSavings}
        recurringSavingOverrides={[{ recurring_saving_id: 'rs1', monthly_amount_override_vnd: 0 }]}
      />,
    )
    await userEvent.click(screen.getByText('Retirement'))
    expect(screen.queryByRole('button', { name: /Record deposit/i })).not.toBeInTheDocument()
  })

  it('shows the recurring saving as done once a matching deposit is logged', async () => {
    const savings: DirectSaving[] = [
      {
        transaction_id: 'd1', plan_id: 'plan-1', goal_id: 'g1', amount_vnd: 2_000_000,
        interest_rate: null, expiry_date: null, investment_date: '2026-05-10',
        savings_goals: { goal_name: 'Retirement' },
      },
    ]
    render(<MobilePlanningView {...defaultProps} plan={basePlan} recurringSavings={recurringSavings} savings={savings} />)
    // Goal header reflects the logged contribution (2M in).
    expect(screen.getByText(/₫ 2000000 in/)).toBeInTheDocument()
    // Expand the goal — the line is recorded, so no Record deposit button.
    await userEvent.click(screen.getByText('Retirement'))
    expect(screen.queryByRole('button', { name: /Record deposit/i })).not.toBeInTheDocument()
  })

  it('renders a skipped DCA fund with a Restore action', async () => {
    render(
      <MobilePlanningView
        {...defaultProps}
        plan={basePlan}
        goals={[{ goal_id: 'g1', goal_name: 'Retirement' }]}
        funds={[{ id: 'f1', name: 'VFMVF1', nav: 36120, is_dca: true, dca_monthly_amount_vnd: 5_000_000, dca_goal_id: 'g1' }]}
        dcaSkips={[{ fund_id: 'f1' }]}
      />,
    )
    await userEvent.click(screen.getByText('Retirement'))
    expect(screen.getByText('VFMVF1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Restore DCA/i })).toBeInTheDocument()
  })
})
