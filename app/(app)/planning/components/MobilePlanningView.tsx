'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
import { Target, Shield, ShoppingCart, Plus, Settings } from 'lucide-react'
import { fmt, fmtCompact } from '@/lib/formatters'
import FixedExpenseManager from './FixedExpenseManager'
import RecurringSavingManager from './RecurringSavingManager'
import AddTransactionSheet, { type EditableTransaction, type PrefillTransaction } from '@/app/assets/components/AddTransactionSheet'
import RecurringBookTopUpSheet, { type BookTopUpTarget } from '@/app/assets/components/RecurringBookTopUpSheet'
import AddInsuranceMemberModal from '@/app/assets/components/AddInsuranceMemberModal'
import { useDialogA11y } from './useDialogA11y'
import { EditIcon } from './planningIcons'
import { GoalAllocationRow, PlanLineItem } from './planningRows'
import { NoPlanState, PlanErrorState, SalaryCard, AllocationSummaryCard, FixedExpIcon, BudgetSection } from './planningCards'
import { Sheet, SalarySheet, DeletePlanSheet, OtherExpenseSheet, SimpleOverrideSheet } from './planningSheets'
import { type GoalRow, type GoalItem } from '@/lib/planning'
import { usePlanningDerivations } from '../usePlanningDerivations'
import { usePlanningActions, buildBuyEdit, buildContributionPrefill } from '../usePlanningActions'
import { relationshipLabel } from '@/app/assets/components/insuranceShared'
import { MobilePlanningSkeleton } from './PlanningSkeleton'
import type {
  MonthlyPlan, FundInvestment, DirectSaving, FixedExpense,
  InsuranceMember, OtherExpense, RecurringSaving, RecurringSavingOverride, RecurringFulfillment, DcaSkip, Fund, Goal,
} from '../PlanningClient'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  month: number
  year: number
  plan: MonthlyPlan | null
  investments: FundInvestment[]
  savings: DirectSaving[]
  fixedExpenses: FixedExpense[]
  insuranceMembers: InsuranceMember[]
  otherExpenses: OtherExpense[]
  recurringSavings: RecurringSaving[]
  recurringSavingOverrides: RecurringSavingOverride[]
  recurringFulfillments: RecurringFulfillment[]
  dcaSkips: DcaSkip[]
  funds: Fund[]
  goals: Goal[]
  loading?: boolean
  error?: boolean
  onRetry?: () => void
  onPlanCreated: (plan: MonthlyPlan) => void
  onPlanDeleted: () => void
  onRefresh: () => void
  onToast: (msg: string) => void
}

type SheetState =
  | null
  | { type: 'salary' }
  | { type: 'delete-plan' }
  | { type: 'override-fe'; expense: FixedExpense }
  | { type: 'override-ins'; member: InsuranceMember }
  | { type: 'override-rec'; item: GoalItem }
  | { type: 'other-expense'; existing: OtherExpense | null }
  | { type: 'manage-fixed' }
  | { type: 'manage-recurring'; editId?: string }

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const LONG_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

function getMonthLabel(month: number, year: number, short = false) {
  const names = short ? SHORT_MONTHS : LONG_MONTHS
  return `${names[month - 1]} ${year}`
}


// ─── Main MobilePlanningView ──────────────────────────────────────────────────

export default function MobilePlanningView({
  month, year, plan, investments, savings, fixedExpenses, insuranceMembers, otherExpenses,
  recurringSavings, recurringSavingOverrides, recurringFulfillments, dcaSkips, funds, goals, loading, error,
  onRetry, onPlanCreated, onPlanDeleted, onRefresh, onToast,
}: Props) {
  const locale = useLocale()
  const isVI = locale === 'vi'
  const [sheet, setSheet] = useState<SheetState>(null)
  // Recording a DCA buy opens the canonical Add-Transaction sheet in edit mode,
  // pre-filled from the planned investment, so saving completes that same
  // planned row (PUT) rather than adding a duplicate contribution.
  const [buyEdit, setBuyEdit] = useState<EditableTransaction | null>(null)
  const [prefillTx, setPrefillTx] = useState<PrefillTransaction | null>(null)
  const [bookTopUp, setBookTopUp] = useState<BookTopUpTarget | null>(null)
  const [showAddInsurance, setShowAddInsurance] = useState(false)
  const [overrideTarget, setOverrideTarget] = useState<{ type: 'fe' | 'ins' | 'rec'; id: string; name: string; defaultAmount: number } | null>(null)

  const monthLabel = getMonthLabel(month, year)

  // ─── Computed totals ────────────────────────────────────────────────────────

  // Derived model shared with the desktop view via usePlanningDerivations (#467).
  const {
    goalsById, resolvedRecurring, skippedDcaInvestments, fulfillments, byGoal,
    totalGoals, contributedTotal, totalFixed, totalInsurance, totalOther, totalOutflow, remaining,
  } = usePlanningDerivations({
    plan, investments, savings, fixedExpenses, insuranceMembers, otherExpenses,
    recurringSavings, recurringSavingOverrides, recurringFulfillments, dcaSkips, funds, goals, isVI,
  })

  // ─── Skip/restore handlers ─────────────────────────────────────────────────
  // Shared with the desktop view via usePlanningActions so both surfaces stay
  // in lock-step (#467).
  const actions = usePlanningActions({ plan, month, year, isVI, onRefresh, onToast })
  const handleSkipFE = actions.skipFixedExpense
  const handleRestoreFE = actions.restoreFixedExpense
  const handleSkipIns = actions.skipInsurance
  const handleRestoreIns = actions.restoreInsurance
  const handleSkipRec = actions.skipRecurring
  const handleRestoreRec = actions.restoreRecurring
  const handleDcaSkip = actions.skipDca
  const handleDcaRestore = actions.restoreDca

  function openOverrideRec(item: GoalItem) {
    if (!item.recurringId) return
    setOverrideTarget({ type: 'rec', id: item.recurringId, name: item.name, defaultAmount: item.baseAmount ?? item.amount })
    setSheet({ type: 'override-rec', item })
  }

  // Open the Add-Transaction sheet in create mode, pre-filled toward a goal —
  // the goal-header "+" (log any contribution) and the recurring-bank "Saved"
  // pill (record this month's deposit at the planned amount).
  function openContribution(entry: GoalRow, prefill?: Partial<PrefillTransaction>) {
    setPrefillTx(buildContributionPrefill(entry, plan?.id ?? null, prefill))
  }

  // The recurring "Saved" pill: the shared probe decides between the book top-up
  // sheet, a standalone contribution, or a matured-book steer.
  async function recordRecurring(entry: GoalRow, item: GoalItem) {
    const result = await actions.probeRecurringRecord(item)
    if (result.kind === 'book-topup') setBookTopUp(result.target)
    else if (result.kind === 'contribution') openContribution(entry, { asset_type: 'bank', amount_vnd: item.amount })
  }

  function openBuy(item: GoalItem) {
    const edit = buildBuyEdit(item.transactionId, investments)
    if (edit) setBuyEdit(edit)
  }

  // ─── Override sheet helpers ────────────────────────────────────────────────

  function openOverrideFE(expense: FixedExpense) {
    const defaultAmt = (expense.override != null && expense.override > 0) ? expense.override : expense.amount_vnd
    setOverrideTarget({ type: 'fe', id: expense.expense_id, name: expense.expense_name, defaultAmount: defaultAmt })
    setSheet({ type: 'override-fe', expense })
  }

  function openOverrideIns(member: InsuranceMember) {
    const defaultAmt = member.monthlyOverride ?? Math.round(member.annual_payment_vnd / 12)
    setOverrideTarget({ type: 'ins', id: member.member_id, name: member.member_name, defaultAmount: defaultAmt })
    setSheet({ type: 'override-ins', member })
  }

  // The single source of truth for an override write lives in usePlanningActions;
  // this closes the sheet on success. SimpleOverrideSheet stays presentational.
  async function handleOverrideSave(amount: number) {
    if (!overrideTarget) return
    const ok = await actions.saveOverride({ type: overrideTarget.type, id: overrideTarget.id, amount })
    if (ok) { setSheet(null); setOverrideTarget(null) }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="md:hidden" style={{ background: 'var(--c-canvas)', minHeight: '100%' }}>
      <div style={{ padding: '4px 16px 100px', display: 'grid', gap: 10 }}>
        {loading ? (
          <MobilePlanningSkeleton />
        ) : error ? (
          <PlanErrorState isVI={isVI} onRetry={onRetry} />
        ) : !plan ? (
          <NoPlanState monthLabel={monthLabel} isVI={isVI} onSetSalary={() => setSheet({ type: 'salary' })} />
        ) : (
          <>
            {/* Salary card */}
            <SalaryCard
              amount={plan.salary_vnd}
              isVI={isVI}
              onEdit={() => setSheet({ type: 'salary' })}
              onDelete={() => setSheet({ type: 'delete-plan' })}
            />

            {/* Summary strip */}
            <div style={{
              border: '1px solid var(--c-line)',
              borderRadius: 16, boxShadow: 'var(--shadow-card)',
              display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 1, overflow: 'hidden', background: 'var(--c-line)',
            } as React.CSSProperties}>
              {[
                { l: isVI ? 'Tổng chi' : 'Outflow', v: fmtCompact(totalOutflow), c: 'var(--c-ink)' },
                { l: isVI ? 'Còn lại' : 'Remaining', v: fmtCompact(remaining), c: remaining >= 0 ? 'var(--c-pos)' : 'var(--c-neg)' },
                { l: isVI ? '% Tiết kiệm' : 'Saved %', v: plan.salary_vnd > 0 ? `${Math.round((totalGoals / plan.salary_vnd) * 100)}%` : '—', c: 'var(--c-navy)' },
              ].map((k, i) => (
                <div key={i} style={{ background: 'var(--c-card)', padding: '10px 12px' }}>
                  <div style={{ fontSize: 10, color: 'var(--c-muted)' }}>{k.l}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: k.c, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                    {k.v}
                  </div>
                </div>
              ))}
            </div>

            {/* Allocation summary card */}
            <AllocationSummaryCard
              salary={plan.salary_vnd}
              totalGoals={totalGoals}
              totalFixed={totalFixed}
              totalInsurance={totalInsurance}
              totalOther={totalOther}
              contributedTotal={contributedTotal}
              isVI={isVI}
            />

            {/* By goal section */}
            <BudgetSection
              icon={Target}
              iconColor="var(--c-navy)"
              title={isVI ? 'Theo mục tiêu' : 'By goal'}
              count={`${byGoal.length} ${isVI ? 'mục tiêu' : byGoal.length === 1 ? 'goal' : 'goals'}`}
              total={totalGoals}
              testId="section-by-goal"
              action={
                <button
                  data-testid="mobile-manage-savings"
                  onClick={() => setSheet({ type: 'manage-recurring' })}
                  aria-label={isVI ? 'Quản lý tiết kiệm định kỳ' : 'Manage recurring savings'}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', fontSize: 12, fontWeight: 600, color: 'var(--c-navy)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 6 }}
                >
                  <Settings size={14} />
                  {isVI ? 'Quản lý' : 'Manage'}
                </button>
              }
            >
              {byGoal.length === 0 ? (
                <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--c-muted)' }}>
                  {isVI ? 'Chưa có phân bổ nào' : 'No allocations yet'}
                </div>
              ) : (
                byGoal.map((entry) => (
                  <GoalAllocationRow
                    key={entry.goalId}
                    entry={entry}
                    isVI={isVI}
                    onRecSkip={handleSkipRec}
                    onRecRestore={handleRestoreRec}
                    onRecOverride={openOverrideRec}
                    onRecEdit={(item) => setSheet({ type: 'manage-recurring', editId: item.recurringId ?? undefined })}
                    onRecordBuy={openBuy}
                    onRecordDeposit={(item) => recordRecurring(entry, item)}
                    onLogContribution={() => openContribution(entry)}
                    onDcaSkip={handleDcaSkip}
                    onDcaRestore={handleDcaRestore}
                  />
                ))
              )}
            </BudgetSection>

            {/* Fixed expenses section */}
            <BudgetSection
                icon={FixedExpIcon}
                iconColor="var(--c-accent-fixed)"
                title={isVI ? 'Chi phí cố định' : 'Fixed expenses'}
                count={`${fixedExpenses.length} ${isVI ? 'khoản' : fixedExpenses.length === 1 ? 'item' : 'items'}`}
                total={totalFixed}
                testId="section-fixed-expenses"
                action={
                  <button
                    data-testid="mobile-manage-fixed"
                    onClick={() => setSheet({ type: 'manage-fixed' })}
                    aria-label={isVI ? 'Quản lý chi phí cố định' : 'Manage fixed expenses'}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', fontSize: 12, fontWeight: 600, color: 'var(--c-navy)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 6 }}
                  >
                    <Settings size={14} />
                    {isVI ? 'Quản lý' : 'Manage'}
                  </button>
                }
              >
                {fixedExpenses.length === 0 && (
                  <div style={{ padding: '14px', fontSize: 13, color: 'var(--c-muted)' }}>
                    {isVI ? 'Chưa có chi phí cố định nào' : 'No fixed expenses yet'}
                  </div>
                )}
                {fixedExpenses.map((fe, i) => {
                  const isSkipped = fe.override === 0
                  const hasOverride = fe.override != null && fe.override > 0 && fe.override !== fe.amount_vnd
                  const thisMonth = isSkipped ? 0 : (fe.override ?? fe.amount_vnd)
                  const secondary = isSkipped
                    ? (isVI ? 'Bỏ qua tháng này' : 'Skipped')
                    : hasOverride ? (isVI ? '(đã ghi đè)' : '(overridden)') : null
                  return (
                    <PlanLineItem
                      key={fe.expense_id}
                      primary={fe.expense_name}
                      secondary={secondary}
                      amount={thisMonth}
                      muted={isSkipped}
                      overridden={hasOverride}
                      last={i === fixedExpenses.length - 1}
                      isVI={isVI}
                      onSkip={() => handleSkipFE(fe)}
                      onRestore={() => handleRestoreFE(fe)}
                      onOverride={() => openOverrideFE(fe)}
                    />
                  )
                })}
              </BudgetSection>

            {/* Insurance section */}
            {/* Shown even with no members (parity with desktop + the other
                sections) so insurance isn't a hidden dead-end — Add member opens
                the same modal the dashboard uses. */}
            <BudgetSection
                icon={Shield}
                iconColor="var(--c-accent-insurance)"
                title={isVI ? 'Bảo hiểm' : 'Insurance'}
                count={`${insuranceMembers.length} ${isVI ? 'thành viên' : insuranceMembers.length === 1 ? 'member' : 'members'}`}
                total={totalInsurance}
                testId="section-insurance"
                action={
                  <button
                    data-testid="mobile-add-insurance"
                    onClick={() => setShowAddInsurance(true)}
                    aria-label={isVI ? 'Thêm thành viên bảo hiểm' : 'Add insurance member'}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', fontSize: 12, fontWeight: 600, color: 'var(--c-navy)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 6 }}
                  >
                    <Plus size={14} strokeWidth={2.4} />
                    {isVI ? 'Thêm' : 'Add'}
                  </button>
                }
              >
                {insuranceMembers.length === 0 && (
                  <div style={{ padding: '14px', fontSize: 13, color: 'var(--c-muted)' }}>
                    {isVI ? 'Chưa có thành viên bảo hiểm nào' : 'No insurance members yet'}
                  </div>
                )}
                {insuranceMembers.map((m, i) => {
                  const defaultMonthly = Math.round(m.annual_payment_vnd / 12)
                  const hasOverride = m.monthlyOverride != null && m.monthlyOverride !== defaultMonthly
                  const thisMonth = m.excluded ? 0 : (m.monthlyOverride ?? defaultMonthly)
                  // A phone has no room for Relationship/Default columns (the desktop
                  // table carries those), so the relationship rides the subtitle line.
                  // When overridden, append the default so the user still sees it.
                  const rel = relationshipLabel(m.relationship, isVI)
                  const secondary = m.excluded
                    ? (isVI ? 'Bỏ qua tháng này' : 'Skipped')
                    : hasOverride
                      ? `${rel ? rel + ' · ' : ''}${isVI ? 'mặc định ' : 'default '}${fmt(defaultMonthly)}`
                      : (rel || (isVI ? 'Đóng góp tháng' : 'Monthly contribution'))
                  return (
                    <PlanLineItem
                      key={m.member_id}
                      primary={m.member_name}
                      secondary={secondary}
                      amount={thisMonth}
                      muted={m.excluded}
                      overridden={hasOverride}
                      last={i === insuranceMembers.length - 1}
                      isVI={isVI}
                      onSkip={() => handleSkipIns(m)}
                      onRestore={() => handleRestoreIns(m)}
                      onOverride={() => openOverrideIns(m)}
                    />
                  )
                })}
              </BudgetSection>

            {/* Other expenses section */}
            <BudgetSection
              icon={ShoppingCart}
              iconColor="var(--c-accent-other)"
              title={isVI ? 'Khoản khác' : 'Other'}
              count={`${otherExpenses.length} ${isVI ? 'khoản' : otherExpenses.length === 1 ? 'one-off' : 'one-offs'}`}
              total={totalOther}
              testId="section-other"
            >
              {otherExpenses.map((o, i) => (
                <div
                  key={o.id}
                  style={{
                    padding: '10px 14px 10px 60px', display: 'flex', alignItems: 'center', gap: 8,
                    borderBottom: i === otherExpenses.length - 1 ? 'none' : '1px solid var(--c-line)',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--c-ink)' }}>
                      {o.description}
                    </div>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--c-ink)' }}>
                    {fmt(o.amount_vnd)}
                  </span>
                  <button
                    onClick={() => { setSheet({ type: 'other-expense', existing: o }) }}
                    aria-label="Edit expense"
                    style={{ minWidth: 44, minHeight: 44, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                  >
                    <EditIcon size={14} color="var(--c-muted)" />
                  </button>
                </div>
              ))}
              <div style={{ padding: '10px 14px 12px 60px' }}>
                <button
                  onClick={() => { setSheet({ type: 'other-expense', existing: null }) }}
                  style={{
                    padding: '4px 0', fontSize: 12, color: 'var(--c-navy)',
                    border: 'none', background: 'transparent', cursor: 'pointer',
                    fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4,
                  }}
                >
                  <Plus size={12} strokeWidth={2.4} />
                  {isVI ? 'Thêm khoản' : 'Add item'}
                </button>
              </div>
            </BudgetSection>
          </>
        )}
      </div>

      {/* ─── Salary sheet ──────────────────────────────────────────────────── */}
      <SalarySheet
        open={sheet?.type === 'salary'}
        onClose={() => setSheet(null)}
        plan={plan}
        month={month}
        year={year}
        onPlanCreated={onPlanCreated}
        onRefresh={onRefresh}
        onToast={onToast}
      />

      {/* ─── Delete plan sheet ─────────────────────────────────────────────── */}
      {plan && (
        <DeletePlanSheet
          open={sheet?.type === 'delete-plan'}
          onClose={() => setSheet(null)}
          monthLabel={monthLabel}
          onPlanDeleted={onPlanDeleted}
          planId={plan.id}
          onToast={onToast}
        />
      )}

      {/* ─── Override sheet ────────────────────────────────────────────────── */}
      {overrideTarget && plan && (
        <SimpleOverrideSheet
          open={sheet?.type === 'override-fe' || sheet?.type === 'override-ins' || sheet?.type === 'override-rec'}
          onClose={() => { setSheet(null); setOverrideTarget(null) }}
          name={overrideTarget.name}
          defaultAmount={overrideTarget.defaultAmount}
          isVI={isVI}
          onSaved={handleOverrideSave}
        />
      )}

      {/* ─── Other expense sheet ───────────────────────────────────────────── */}
      {plan && (
        <OtherExpenseSheet
          open={sheet?.type === 'other-expense'}
          onClose={() => setSheet(null)}
          existing={sheet?.type === 'other-expense' ? sheet.existing : null}
          planId={plan.id}
          onRefresh={onRefresh}
          onToast={onToast}
        />
      )}

      {/* ─── Manage fixed expenses sheet ───────────────────────────────────── */}
      <Sheet
        open={sheet?.type === 'manage-fixed'}
        onClose={() => setSheet(null)}
        title={isVI ? 'Quản lý chi phí cố định' : 'Manage fixed expenses'}
      >
        {sheet?.type === 'manage-fixed' && (
          <FixedExpenseManager onChange={onRefresh} onToast={onToast} variant="sheet" />
        )}
      </Sheet>

      {/* ─── Manage recurring savings sheet ─────────────────────────────────── */}
      <Sheet
        open={sheet?.type === 'manage-recurring'}
        onClose={() => setSheet(null)}
        title={isVI ? 'Tiết kiệm định kỳ' : 'Recurring savings'}
      >
        {sheet?.type === 'manage-recurring' && (
          <RecurringSavingManager goals={goals} onChange={onRefresh} onToast={onToast} variant="sheet" editSavingId={sheet.type === 'manage-recurring' ? sheet.editId : undefined} />
        )}
      </Sheet>

      {/* ─── Record buy (edit) / log contribution (create) → Add-Transaction ── */}
      <AddTransactionSheet
        open={!!buyEdit || !!prefillTx}
        existing={buyEdit}
        prefill={prefillTx}
        onClose={() => { setBuyEdit(null); setPrefillTx(null) }}
        onSaved={() => {
          const wasBuy = !!buyEdit
          setBuyEdit(null); setPrefillTx(null)
          onToast(wasBuy ? (isVI ? 'Đã ghi nhận mua' : 'Buy recorded') : (isVI ? 'Đã ghi nhận đóng góp' : 'Contribution logged'))
          onRefresh()
        }}
      />

      <RecurringBookTopUpSheet
        target={bookTopUp}
        isVi={isVI}
        onClose={() => setBookTopUp(null)}
        onDone={() => { onToast(isVI ? 'Đã nạp vào sổ' : 'Topped up book'); onRefresh() }}
      />

      <AddInsuranceMemberModal
        open={showAddInsurance}
        locale={locale}
        onClose={() => setShowAddInsurance(false)}
        onCreated={() => { onToast(isVI ? 'Đã thêm thành viên' : 'Member added'); onRefresh() }}
      />
    </div>
  )
}
