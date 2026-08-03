'use client'

import { useState, useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations, useLocale } from 'next-intl'
import { useNavigation } from '@/components/navigation/NavigationContext'
import MobilePlanningView from './components/MobilePlanningView'
import DesktopPlanningView from './components/DesktopPlanningView'
import { useAdoptCacheOnce } from '@/lib/useHydrated'
import { businessYearMonth } from '@/lib/dates'

export interface MonthlyPlan {
  id: string
  month: number
  year: number
  salary_vnd: number
}

export interface FundInvestment {
  transaction_id: string
  plan_id: string
  fund_id: string
  goal_id: string | null
  amount_vnd: number
  units: number | null
  unit_price: number | null
  investment_date: string | null
  is_dca_seeded: boolean
  funds: { name: string; nav: number } | null
  savings_goals: { goal_name: string } | null
}

export interface DirectSaving {
  transaction_id: string
  plan_id: string
  goal_id: string | null
  amount_vnd: number
  interest_rate: number | null
  expiry_date: string | null
  investment_date: string
  savings_goals: { goal_name: string } | null
}

export interface FixedExpense {
  expense_id: string
  expense_name: string
  amount_vnd: number
  override?: number // overridden monthly amount if set
}

export interface InsuranceMember {
  member_id: string
  member_name: string
  relationship: string
  annual_payment_vnd: number
  payment_date: string | null
  excluded?: boolean
  monthlyOverride?: number
}

export interface OtherExpense {
  id: string
  plan_id: string
  description: string
  amount_vnd: number
  created_at: string
}

export interface RecurringSaving {
  saving_id: string
  name: string
  goal_id: string | null
  amount_vnd: number
  effective_from: string | null
  effective_to: string | null
  linked_deposit_tx_id?: string | null
  savings_goals: { goal_name: string } | null
}

export interface RecurringSavingOverride {
  recurring_saving_id: string
  monthly_amount_override_vnd: number
}

// A recurring recorded this month via maturity-combine / book top-up. amount_vnd
// is what was fulfilled; source distinguishes whether a plan-scoped deposit was
// also logged (book top-up) so contributed isn't double-counted.
export interface RecurringFulfillment {
  recurring_saving_id: string
  amount_vnd: number
  source: string
}

export interface Fund {
  id: string; name: string; nav: number
  is_dca?: boolean
  dca_monthly_amount_vnd?: number | null
  dca_goal_id?: string | null
}

export interface DcaSkip { fund_id: string }
export interface Goal { goal_id: string; goal_name: string }

const PLAN_CACHE_TTL = 2 * 60 * 1000
function getPlanCache(month: number, year: number) {
  try {
    const raw = localStorage.getItem(`planningCache_${month}_${year}`)
    if (!raw) return null
    const { data, ts } = JSON.parse(raw)
    if (Date.now() - ts > PLAN_CACHE_TTL) return null
    return data
  } catch { return null }
}
function setPlanCache(month: number, year: number, data: unknown) {
  try { localStorage.setItem(`planningCache_${month}_${year}`, JSON.stringify({ data, ts: Date.now() })) } catch {}
}
function bustPlanCache(month: number, year: number) {
  try { localStorage.removeItem(`planningCache_${month}_${year}`) } catch {}
}

function prevMonth(m: number, y: number) { return m === 1 ? { m: 12, y: y - 1 } : { m: m - 1, y } }
function nextMonth(m: number, y: number) { return m === 12 ? { m: 1, y: y + 1 } : { m: m + 1, y } }

const SHORT_MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const SHORT_MONTHS_VI = ['Th1','Th2','Th3','Th4','Th5','Th6','Th7','Th8','Th9','Th10','Th11','Th12']

export default function PlanningClient() {
  const t = useTranslations('planning')
  const locale = useLocale()
  const isVI = locale === 'vi'
  const { setMobileTopBar } = useNavigation()
  const MONTHS = t('months').split(',')
  // The plan opens on the *business* month (see lib/dates) — deriving it from the
  // browser's local zone put a user abroad, or one loading the page between 00:00
  // and 06:59 Vietnam time in a UTC browser, on the wrong month's plan (#591).
  const { year: initialYear, month: initialMonth } = businessYearMonth()
  // Start where the server starts. These used to seed from getPlanCache(), but a
  // useState initialiser runs during the *hydration* render and the server has no
  // localStorage — so a warm cache made the client render the real cards over
  // server HTML that held the skeleton, and React discarded the tree (#560).
  const [month, setMonth] = useState(initialMonth)
  const [year, setYear] = useState(initialYear)
  const [plan, setPlan] = useState<MonthlyPlan | null>(null)
  const [investments, setInvestments] = useState<FundInvestment[]>([])
  const [savings, setSavings] = useState<DirectSaving[]>([])
  const [fixedExpenses, setFixedExpenses] = useState<FixedExpense[]>([])
  const [insuranceMembers, setInsuranceMembers] = useState<InsuranceMember[]>([])
  const [otherExpenses, setOtherExpenses] = useState<OtherExpense[]>([])
  const [recurringSavings, setRecurringSavings] = useState<RecurringSaving[]>([])
  const [recurringSavingOverrides, setRecurringSavingOverrides] = useState<RecurringSavingOverride[]>([])
  const [dcaSkips, setDcaSkips] = useState<DcaSkip[]>([])
  const [recurringFulfillments, setRecurringFulfillments] = useState<RecurringFulfillment[]>([])
  const [funds, setFunds] = useState<Fund[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)

  // Adopt the cached month on the first render after hydration. This preserves
  // what the cache was for — no skeleton flash while the refetch is in flight —
  // and costs nothing net, since a mismatch regenerated this tree anyway.
  //
  // The `loading` guard is what keeps a settled fetch from being overwritten by
  // the older cache. Unlike the fund library, fetchPlan() does not bust on mount,
  // but it can still land first; and once it has settled, its answer is the right
  // one even when that answer is "this month has no plan" (404) — showing the
  // stale month back would be a lie.
  useAdoptCacheOnce(
    () => getPlanCache(initialMonth, initialYear),
    (cached) => {
      if (!loading) return
      setPlan(cached.plan ?? null)
      setInvestments(cached.investments ?? [])
      setSavings(cached.savings ?? [])
      setFixedExpenses(cached.fixedExpenses ?? [])
      setInsuranceMembers(cached.insuranceMembers ?? [])
      setOtherExpenses(cached.otherExpenses ?? [])
      setRecurringSavings(cached.recurringSavings ?? [])
      setRecurringSavingOverrides(cached.recurringSavingOverrides ?? [])
      setDcaSkips(cached.dcaSkips ?? [])
      setRecurringFulfillments(cached.recurringFulfillments ?? [])
      setFunds(cached.funds ?? [])
      setGoals(cached.goals ?? [])
      setLoading(false)
    },
  )
  // A failed load (≠ 404) must not masquerade as the legit "no plan yet" empty
  // state — the API returns 404 only when the month genuinely has no plan.
  const [loadError, setLoadError] = useState(false)

  // Surface confirmations through the globally-mounted sonner Toaster (neutral —
  // onToast carries both confirmations and the "book has matured" warning).
  const showToast = useCallback((msg: string) => { toast(msg) }, [])

  const fetchPlan = useCallback(async (opts?: { force?: boolean }) => {
    if (opts?.force) bustPlanCache(month, year)

    let res: Response
    try {
      res = await fetch(`/api/v1/monthly-plans?month=${month}&year=${year}&full=true`)
    } catch {
      setLoadError(true)
      setLoading(false)
      return
    }
    if (res.ok) {
      setLoadError(false)
      const p = await res.json()

      const overrideMap = new Map(
        (p.fixed_expense_overrides as Array<{ fixed_expense_id: string; monthly_amount_override_vnd: number }>)
          .map((o) => [o.fixed_expense_id, o.monthly_amount_override_vnd])
      )
      const fixedExpenses = (p.fixed_expenses as Array<{ expense_id: string; expense_name: string; amount_vnd: number }>).map((e) => ({
        ...e,
        override: overrideMap.get(e.expense_id),
      }))

      const excludedSet = new Set(
        (p.excluded_insurance as Array<{ member_id: string }>).map((e) => e.member_id)
      )
      const insOverrideMap = new Map(
        (p.insurance_overrides as Array<{ member_id: string; monthly_amount_override_vnd: number }>)
          .map((o) => [o.member_id, o.monthly_amount_override_vnd])
      )
      const insuranceMembers = (p.insurance_members as InsuranceMember[]).map((m) => ({
        ...m,
        excluded: excludedSet.has(m.member_id),
        monthlyOverride: insOverrideMap.get(m.member_id),
      }))

      const plan = { id: p.id, month: p.month, year: p.year, salary_vnd: p.salary_vnd }
      const fresh = {
        plan,
        investments: p.fund_investments ?? [],
        savings: p.direct_savings ?? [],
        fixedExpenses,
        insuranceMembers,
        otherExpenses: p.other_expenses ?? [],
        goals: p.goals ?? [],
        funds: p.funds ?? [],
        recurringSavings: p.recurring_savings ?? [],
        recurringSavingOverrides: p.recurring_saving_overrides ?? [],
        dcaSkips: p.dca_skips ?? [],
        recurringFulfillments: p.recurring_fulfillments ?? [],
      }
      setPlanCache(month, year, fresh)
      setPlan(fresh.plan)
      setInvestments(fresh.investments)
      setSavings(fresh.savings)
      setFixedExpenses(fresh.fixedExpenses)
      setInsuranceMembers(fresh.insuranceMembers)
      setOtherExpenses(fresh.otherExpenses)
      setGoals(fresh.goals)
      setFunds(fresh.funds)
      setRecurringSavings(fresh.recurringSavings)
      setRecurringSavingOverrides(fresh.recurringSavingOverrides)
      setDcaSkips(fresh.dcaSkips)
      setRecurringFulfillments(fresh.recurringFulfillments)
    } else if (res.status === 404) {
      // Genuine "no plan for this month yet" → the empty state.
      setLoadError(false)
      bustPlanCache(month, year)
      setPlan(null)
      setInvestments([])
      setSavings([])
      setOtherExpenses([])
      setGoals([])
      setFunds([])
      setRecurringSavings([])
      setRecurringSavingOverrides([])
      setDcaSkips([])
      setRecurringFulfillments([])
      // Still load fixed expenses and insurance even without a plan
      try {
        const [expRes, insRes] = await Promise.all([
          fetch('/api/v1/fixed-expenses'),
          fetch('/api/v1/insurance-members'),
        ])
        const { expenses } = expRes.ok ? await expRes.json() : { expenses: [] }
        setFixedExpenses((expenses ?? []).map((e: { expense_id: string; expense_name: string; amount_vnd: number }) => ({ ...e })))
        const { members } = insRes.ok ? await insRes.json() : { members: [] }
        setInsuranceMembers(members ?? [])
      } catch { /* leave fixed/insurance empty — the month is still a valid empty plan */ }
    } else {
      // 401 / 500 / etc — a real failure. Keep whatever's shown and surface an
      // error state with retry rather than pretending the month is empty.
      setLoadError(true)
    }
    setLoading(false)
  }, [month, year])

  // fetchPlan raises its own loading flag before awaiting, which is what the
  // rule sees. Fetching on mount is the effect's job, and there is nothing to
  // derive from: the answer only exists after the request. Hoisting the flag to
  // render time would mean rendering a loading state for a fetch that hasn't
  // been issued.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- data load; see above
  useEffect(() => { fetchPlan() }, [fetchPlan])

  const refetch = useCallback(() => fetchPlan({ force: true }), [fetchPlan])

  const navigatePrev = useCallback(() => {
    const { m, y } = prevMonth(month, year)
    setMonth(m); setYear(y)
  }, [month, year])

  const navigateNext = useCallback(() => {
    const { m, y } = nextMonth(month, year)
    setMonth(m); setYear(y)
  }, [month, year])

  const navigateToday = useCallback(() => {
    const { year, month } = businessYearMonth()
    setMonth(month)
    setYear(year)
  }, [])

  useEffect(() => {
    const shortMonths = isVI ? SHORT_MONTHS_VI : SHORT_MONTHS_EN
    const shortLabel = `${shortMonths[month - 1]} ${year}`
    setMobileTopBar({
      title: isVI ? 'Kế hoạch Tháng' : 'Monthly Plan',
      subtitle: isVI ? 'Kế hoạch' : 'Planning',
      trailing: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {!(month === initialMonth && year === initialYear) && (
          <button
            onClick={navigateToday}
            data-testid="mobile-today"
            aria-label={isVI ? 'Về tháng hiện tại' : 'Jump to current month'}
            style={{ minWidth: 36, minHeight: 36, border: '1px solid var(--c-line)', background: 'var(--c-card)', cursor: 'pointer', borderRadius: 8, color: 'var(--c-navy)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <RotateCcw size={15} />
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: 3, background: 'var(--c-card-2)', border: '1px solid var(--c-line)', borderRadius: 10 }}>
          <button
            onClick={navigatePrev}
            data-testid="mobile-prev-month"
            aria-label="Previous month"
            style={{ padding: 6, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, display: 'flex', alignItems: 'center' }}
          >
            <ChevronLeft size={16} color="var(--c-ink)" />
          </button>
          <span style={{ padding: '4px 10px', minWidth: 78, textAlign: 'center', fontSize: 13, fontWeight: 600, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums', background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 7 }}>
            {shortLabel}
          </span>
          <button
            onClick={navigateNext}
            data-testid="mobile-next-month"
            aria-label="Next month"
            style={{ padding: 6, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, display: 'flex', alignItems: 'center' }}
          >
            <ChevronRight size={16} color="var(--c-ink)" />
          </button>
        </div>
        </div>
      ),
    })
    return () => setMobileTopBar({ title: '' })
  }, [month, year, isVI, initialMonth, initialYear, navigatePrev, navigateNext, navigateToday, setMobileTopBar])

  return (
    <>
      {/* Mobile view — replaces the desktop layout on small screens */}
      <MobilePlanningView
        month={month}
        year={year}
        plan={plan}
        investments={investments}
        savings={savings}
        fixedExpenses={fixedExpenses}
        insuranceMembers={insuranceMembers}
        otherExpenses={otherExpenses}
        recurringSavings={recurringSavings}
        recurringSavingOverrides={recurringSavingOverrides}
        recurringFulfillments={recurringFulfillments}
        dcaSkips={dcaSkips}
        funds={funds}
        goals={goals}
        loading={loading}
        error={loadError}
        onRetry={refetch}
        onPlanCreated={(p) => { setPlan(p); refetch() }}
        onPlanDeleted={() => {
          bustPlanCache(month, year)
          setPlan(null)
          setInvestments([])
          setSavings([])
          setFixedExpenses([])
          showToast(t('deletedToast', { month: MONTHS[month - 1], year }))
        }}
        onRefresh={refetch}
        onToast={showToast}
      />

      {/* Desktop view — hidden on mobile */}
      <DesktopPlanningView
        month={month}
        year={year}
        plan={plan}
        investments={investments}
        savings={savings}
        fixedExpenses={fixedExpenses}
        insuranceMembers={insuranceMembers}
        otherExpenses={otherExpenses}
        recurringSavings={recurringSavings}
        recurringSavingOverrides={recurringSavingOverrides}
        recurringFulfillments={recurringFulfillments}
        dcaSkips={dcaSkips}
        funds={funds}
        goals={goals}
        loading={loading}
        error={loadError}
        onRetry={refetch}
        onPrev={navigatePrev}
        onNext={navigateNext}
        onToday={navigateToday}
        onPlanCreated={(p) => { setPlan(p); refetch() }}
        onPlanDeleted={() => {
          bustPlanCache(month, year)
          setPlan(null)
          setInvestments([])
          setSavings([])
          setFixedExpenses([])
          showToast(t('deletedToast', { month: MONTHS[month - 1], year }))
        }}
        onRefresh={refetch}
        onToast={showToast}
      />
    </>
  )
}
