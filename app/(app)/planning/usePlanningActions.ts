import { toast } from 'sonner'
import { todayIso } from '@/lib/dates'
import type { GoalItem, GoalRow } from '@/lib/planning'
import type { EditableTransaction, PrefillTransaction } from '@/app/assets/components/AddTransactionSheet'
import type { BookTopUpTarget } from '@/app/assets/components/RecurringBookTopUpSheet'
import type { MonthlyPlan, FixedExpense, InsuranceMember, FundInvestment } from './PlanningClient'

export type OverrideType = 'fe' | 'rec' | 'ins'

export type RecordRecurringResult =
  | { kind: 'matured' }
  | { kind: 'book-topup'; target: BookTopUpTarget }
  | { kind: 'contribution' }

// Build the Add-Transaction edit payload for recording a planned DCA buy. Pure —
// no state, so both views share it and drive their own editor state.
export function buildBuyEdit(
  transactionId: string | undefined,
  investments: FundInvestment[],
): EditableTransaction | null {
  if (!transactionId) return null
  const inv = investments.find(i => i.transaction_id === transactionId)
  if (!inv) return null
  return {
    transaction_id: inv.transaction_id,
    asset_type: 'fund',
    investment_date: inv.investment_date ?? todayIso(),
    amount_vnd: inv.amount_vnd,
    unit_price: inv.unit_price,
    units: inv.units,
    interest_rate: null,
    expiry_date: null,
    notes: null,
    fund_id: inv.fund_id,
    goal_id: inv.goal_id,
  }
}

// Build the create-mode Add-Transaction prefill for logging a contribution toward
// a goal (or Unallocated). Pure.
export function buildContributionPrefill(
  entry: Pick<GoalRow, 'goalId' | 'isUnallocated'>,
  planId: string | null,
  prefill?: Partial<PrefillTransaction>,
): PrefillTransaction {
  return {
    goal_id: entry.isUnallocated ? null : entry.goalId,
    plan_id: planId,
    investment_date: todayIso(),
    ...prefill,
  }
}

export interface PlanningActionsCtx {
  plan: MonthlyPlan | null
  month: number
  year: number
  isVI: boolean
  onRefresh: () => void
  onToast: (msg: string) => void
}

// The single implementation of the planning page's plan-mutation actions —
// skip/restore for each line type, override writes, and the record-recurring
// probe. Previously copy-pasted (and subtly diverged) across the mobile and
// desktop views; now both call this so a fix lands on both surfaces (#467).
//
// Reconciled divergences vs the old duplicated handlers:
//  - restore always reports success (toast + refresh) even when there was no
//    override row to delete (desktop behaviour; mobile used to return silently);
//  - restoring an insurance member also clears any per-plan insurance override
//    (desktop behaviour; mobile used to leave a stale override behind).
export function usePlanningActions(ctx: PlanningActionsCtx) {
  const { plan, month, year, isVI, onRefresh, onToast } = ctx
  const failMsg = isVI ? 'Có lỗi, vui lòng thử lại' : 'Something went wrong — please try again'

  function fail() { toast.error(failMsg) }
  function done(msg: string) { onRefresh(); onToast(msg) }

  async function skipFixedExpense(expense: FixedExpense) {
    if (!plan) return
    const res = await fetch(`/api/v1/monthly-plans/${plan.id}/fixed-expense-overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixed_expense_id: expense.expense_id, monthly_amount_override_vnd: 0 }),
    }).catch(() => null)
    if (!res?.ok) return fail()
    done(isVI ? `Đã bỏ qua ${expense.expense_name}` : `Skipped ${expense.expense_name}`)
  }

  async function restoreFixedExpense(expense: FixedExpense) {
    if (!plan) return
    const res = await fetch(`/api/v1/monthly-plans/${plan.id}/fixed-expense-overrides`).catch(() => null)
    if (!res?.ok) return fail()
    const overrides: Array<{ id: string; fixed_expense_id: string }> = await res.json()
    const match = overrides.find(o => o.fixed_expense_id === expense.expense_id)
    if (match) {
      const del = await fetch(`/api/v1/monthly-plans/${plan.id}/fixed-expense-overrides/${match.id}`, { method: 'DELETE' }).catch(() => null)
      if (!del?.ok) return fail()
    }
    done(isVI ? `Đã khôi phục ${expense.expense_name}` : `Restored ${expense.expense_name}`)
  }

  async function skipInsurance(member: InsuranceMember) {
    if (!plan) return
    const res = await fetch(`/api/v1/monthly-plans/${plan.id}/excluded-insurance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_id: member.member_id }),
    }).catch(() => null)
    if (!res?.ok) return fail()
    done(isVI ? `Đã bỏ qua ${member.member_name}` : `Skipped ${member.member_name}`)
  }

  async function restoreInsurance(member: InsuranceMember) {
    if (!plan) return
    const res = await fetch(`/api/v1/monthly-plans/${plan.id}/excluded-insurance/${member.member_id}`, { method: 'DELETE' }).catch(() => null)
    if (!res?.ok) return fail()
    // Also drop any per-plan override so a restored member starts from its base
    // premium rather than a stale overridden amount. A failure here must NOT
    // report success — otherwise the member reads as restored while still using
    // the old override (mirrors the fixed/recurring restore paths).
    const oRes = await fetch(`/api/v1/monthly-plans/${plan.id}/insurance-overrides`).catch(() => null)
    if (!oRes?.ok) return fail()
    const overrides: Array<{ id: string; member_id: string }> = await oRes.json()
    const match = overrides.find(o => o.member_id === member.member_id)
    if (match) {
      const del = await fetch(`/api/v1/monthly-plans/${plan.id}/insurance-overrides/${match.id}`, { method: 'DELETE' }).catch(() => null)
      if (!del?.ok) return fail()
    }
    done(isVI ? `Đã khôi phục ${member.member_name}` : `Restored ${member.member_name}`)
  }

  async function skipRecurring(item: GoalItem) {
    if (!plan || !item.recurringId) return
    const res = await fetch(`/api/v1/monthly-plans/${plan.id}/recurring-saving-overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recurring_saving_id: item.recurringId, monthly_amount_override_vnd: 0 }),
    }).catch(() => null)
    if (!res?.ok) return fail()
    done(isVI ? `Đã bỏ qua ${item.name}` : `Skipped ${item.name}`)
  }

  async function restoreRecurring(item: GoalItem) {
    if (!plan || !item.recurringId) return
    const res = await fetch(`/api/v1/monthly-plans/${plan.id}/recurring-saving-overrides`).catch(() => null)
    if (!res?.ok) return fail()
    const overrides: Array<{ id: string; recurring_saving_id: string }> = await res.json()
    const match = overrides.find(o => o.recurring_saving_id === item.recurringId)
    if (match) {
      const del = await fetch(`/api/v1/monthly-plans/${plan.id}/recurring-saving-overrides/${match.id}`, { method: 'DELETE' }).catch(() => null)
      if (!del?.ok) return fail()
    }
    done(isVI ? `Đã khôi phục ${item.name}` : `Restored ${item.name}`)
  }

  async function skipDca(item: GoalItem) {
    if (!plan || !item.fundId) return
    const res = await fetch(`/api/v1/monthly-plans/${plan.id}/dca-skips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fund_id: item.fundId }),
    }).catch(() => null)
    if (!res?.ok) return fail()
    done(isVI ? `Đã bỏ qua ${item.name}` : `Skipped ${item.name}`)
  }

  async function restoreDca(item: GoalItem) {
    if (!plan || !item.fundId) return
    const res = await fetch(`/api/v1/monthly-plans/${plan.id}/dca-skips/${item.fundId}`, { method: 'DELETE' }).catch(() => null)
    if (!res?.ok) return fail()
    done(isVI ? `Đã khôi phục ${item.name}` : `Restored ${item.name}`)
  }

  // The single source of truth for an override write, keyed by line type.
  async function saveOverride(input: { type: OverrideType; id: string; amount: number }): Promise<boolean> {
    if (!plan) return false
    const { url, body } = input.type === 'fe'
      ? { url: `/api/v1/monthly-plans/${plan.id}/fixed-expense-overrides`, body: { fixed_expense_id: input.id, monthly_amount_override_vnd: input.amount } }
      : input.type === 'rec'
        ? { url: `/api/v1/monthly-plans/${plan.id}/recurring-saving-overrides`, body: { recurring_saving_id: input.id, monthly_amount_override_vnd: input.amount } }
        : { url: `/api/v1/monthly-plans/${plan.id}/insurance-overrides`, body: { member_id: input.id, monthly_amount_override_vnd: input.amount } }
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    if (!res?.ok) { fail(); return false }
    done(isVI ? 'Đã ghi đè' : 'Override saved')
    return true
  }

  // The recurring "Saved" pill: if the recurring is linked to an accumulating
  // book, it must open the top-up sheet (tranche + fulfillment) — unless the book
  // has matured, in which case steer the user to handle maturity first. Otherwise
  // log a standalone contribution. Returns what the caller should open.
  async function probeRecurringRecord(item: GoalItem): Promise<RecordRecurringResult> {
    if (item.linkedDepositTxId && item.recurringId && plan) {
      try {
        const res = await fetch(`/api/v1/investment-transactions/${item.linkedDepositTxId}`)
        if (res.ok) {
          const dep = await res.json()
          const isBookAnchor = dep.deposit_group_id && dep.deposit_group_id === dep.transaction_id
          if (isBookAnchor) {
            const matured = dep.expiry_date && dep.expiry_date < todayIso()
            if (matured) {
              onToast(isVI ? 'Sổ đã đáo hạn — hãy xử lý đáo hạn trước.' : 'This book has matured — handle its maturity first.')
              return { kind: 'matured' }
            }
            return {
              kind: 'book-topup',
              target: {
                savingId: item.recurringId, bookId: dep.transaction_id,
                bookName: dep.notes || (isVI ? 'Sổ ngân hàng' : 'Bank deposit'),
                ym: `${year}-${String(month).padStart(2, '0')}`, planId: plan.id,
                amount: item.amount, rate: dep.interest_rate ?? null,
              },
            }
          }
        }
      } catch { /* fall through to the standard contribution */ }
    }
    return { kind: 'contribution' }
  }

  return {
    skipFixedExpense, restoreFixedExpense,
    skipInsurance, restoreInsurance,
    skipRecurring, restoreRecurring,
    skipDca, restoreDca,
    saveOverride, probeRecurringRecord,
  }
}
