import { createClient } from '@supabase/supabase-js'
import path from 'path'
import fs from 'fs'
import { assertSafeTestTarget } from './guard'

const USER_FILE = path.join(__dirname, '..', '.auth', 'user.json')

// Defense in depth: every spec that touches the DB imports this module, so the
// guard runs before any client is created — even if a spec is run directly
// without the global setup.
assertSafeTestTarget(process.env.E2E_SUPABASE_URL, { allow: process.env.E2E_ALLOW_PROD === '1' })

const supabase = createClient(
  process.env.E2E_SUPABASE_URL!,
  process.env.E2E_SUPABASE_SERVICE_ROLE_KEY!
)

let _testUserId: string | null = null

async function getTestUserId(): Promise<string> {
  if (_testUserId) return _testUserId
  const { userId } = JSON.parse(fs.readFileSync(USER_FILE, 'utf-8'))
  _testUserId = userId
  return _testUserId
}

export async function createGoal(data: { goal_name: string; target_amount?: number; target_date?: string; icon?: string; priority?: string }) {
  const userId = await getTestUserId()
  const { data: goal, error } = await supabase
    .from('savings_goals')
    .insert({ user_id: userId, ...data })
    .select()
    .single()
  if (error) throw error
  return goal
}

export async function deleteGoal(goalId: string) {
  await supabase.from('savings_goals').delete().eq('goal_id', goalId)
}

export async function createRecurringSaving(data: {
  name: string
  goal_id?: string | null
  amount_vnd: number
  effective_from?: string | null
  effective_to?: string | null
  linked_deposit_tx_id?: string | null
}) {
  const userId = await getTestUserId()
  const { data: saving, error } = await supabase
    .from('recurring_savings')
    .insert({ user_id: userId, ...data })
    .select()
    .single()
  if (error) throw error
  return saving
}

export async function deleteRecurringSaving(savingId: string) {
  await supabase.from('recurring_savings').delete().eq('saving_id', savingId)
}

export async function getRecurringSaving(savingId: string) {
  const { data } = await supabase.from('recurring_savings').select('*').eq('saving_id', savingId).single()
  return data
}

// Mark a recurring saving's month as already settled (folded into a renewed/
// topped-up deposit), mirroring what the maturity-combine/top-up RPCs write. The
// presence of this row tells the real-saved model to skip synthesizing that
// month's contribution, so it isn't counted twice.
export async function createRecurringFulfillment(data: {
  recurring_saving_id: string
  ym: string
  amount_vnd: number
  source?: string
}) {
  const userId = await getTestUserId()
  const { data: row, error } = await supabase
    .from('recurring_saving_fulfillments')
    .insert({ user_id: userId, source: 'maturity-combine', ...data })
    .select()
    .single()
  if (error) throw error
  return row
}

export async function deleteRecurringFulfillments(savingId: string) {
  await supabase.from('recurring_saving_fulfillments').delete().eq('recurring_saving_id', savingId)
}

// Invoke the collapse RPC directly (service role). Lets a spec drive it with a
// deliberately stale tranche set to exercise the mid-flight-change guard.
export async function rpcCollapseBook(args: Record<string, unknown>) {
  return await supabase.rpc('collapse_accumulating_book', args)
}

export async function createInsuranceMember(data: {
  member_name: string
  relationship: string
  annual_payment_vnd: number
  payment_date?: string
}) {
  const userId = await getTestUserId()
  const { data: member, error } = await supabase
    .from('insurance_members')
    .insert({ user_id: userId, ...data })
    .select()
    .single()
  if (error) throw error
  return member
}

export async function deleteInsuranceMember(memberId: string) {
  await supabase.from('insurance_members').delete().eq('member_id', memberId)
}

export async function createInsuranceSaving(data: {
  insurance_member_id: string
  amount_saved_vnd: number
  saved_date?: string
}) {
  const userId = await getTestUserId()
  const { data: row, error } = await supabase
    .from('insurance_savings')
    .insert({ user_id: userId, ...data })
    .select()
    .single()
  if (error) throw error
  return row
}

export async function countInsuranceSavings(memberId: string): Promise<number> {
  const { count } = await supabase
    .from('insurance_savings')
    .select('id', { count: 'exact', head: true })
    .eq('insurance_member_id', memberId)
  return count ?? 0
}

export async function createFixedExpense(data: {
  expense_name: string
  amount_vnd: number
  category: string
  effective_from?: string
  effective_to?: string
}) {
  const userId = await getTestUserId()
  const { data: expense, error } = await supabase
    .from('fixed_expenses')
    .insert({ user_id: userId, ...data })
    .select()
    .single()
  if (error) throw error
  return expense
}

export async function deleteFixedExpense(expenseId: string) {
  await supabase.from('fixed_expenses').delete().eq('expense_id', expenseId)
}

export async function createTransaction(data: {
  asset_type: string
  amount_vnd: number
  investment_date: string
  interest_rate?: number
  expiry_date?: string
  units?: number
  unit_price?: number
  fund_id?: string
  goal_id?: string
  notes?: string
  // Structured bank reference (FK to banks.code) — used by the multi-source merge.
  bank_code?: string
  // Set to mark this row a renewal snapshot of a closed cycle (excluded from net
  // worth and from the recurring deposit-suppression pool).
  renewed_from_transaction_id?: string
}) {
  const userId = await getTestUserId()
  const { data: tx, error } = await supabase
    .from('investment_transactions')
    .insert({ user_id: userId, transaction_type: 'investment', ...data })
    .select()
    .single()
  if (error) throw error
  return tx
}

export async function deleteTransaction(txId: string) {
  await supabase.from('investment_transactions').delete().eq('transaction_id', txId)
}

// Delete every tranche of an accumulating book (rows sharing deposit_group_id).
export async function deleteDepositGroup(groupId: string) {
  await supabase.from('investment_transactions').delete().eq('deposit_group_id', groupId)
}

// Snapshot every tranche id of a live accumulating book (anchor + all top-ups),
// taken WHILE the book is still grouped. A full close later CLEARS deposit_group_id
// on every tranche, so after the close the membership is unrecoverable from the DB.
// Capture this right after building the book and hand it to deleteBookCascade — the
// teardown then can't silently miss a top-up the caller forgot to track by hand.
export async function snapshotBookTranches(anchorId: string): Promise<string[]> {
  const { data: grouped } = await supabase
    .from('investment_transactions')
    .select('transaction_id')
    .eq('deposit_group_id', anchorId)
  return [...new Set([anchorId, ...(grouped ?? []).map((t) => t.transaction_id)])]
}

// Fully tear down an accumulating book: every tranche AND every withdrawal child
// of those tranches. parent_transaction_id is ON DELETE SET NULL, so deleting the
// tranches first (as deleteDepositGroup does) ORPHANS their withdrawal rows — they
// linger as unassigned withdrawals that pollute later specs' global views (the
// dashboard recent-activity card, page-wide text queries). A book partially
// withdrawn writes a withdrawal PER tranche, so this matters whenever a book test
// touched withdrawals.
//
// Discovery is the subtle part: a PARTIAL withdrawal leaves the book intact, so
// tranches are still findable by deposit_group_id. But a FULL close SETTLES the
// book and CLEARS deposit_group_id on every tranche — so the group query finds
// nothing and any top-up tranche (plus its withdrawal child) would survive
// undiscovered. Pass the pre-close snapshot from snapshotBookTranches so the full
// set is known regardless; we union it with whatever is still grouped. Order is
// load-bearing: delete the children first (by parent, while the links are still
// valid), THEN the tranches and the anchor.
//
// Not covered: renewal-history snapshots (renewed_from_transaction_id), which
// deleteTransactionCascade sweeps. Books settle via the collapse/withdraw path and
// never produce those, so it's out of scope here — revisit if a book test ever
// renews a tranche.
export async function deleteBookCascade(anchorId: string, extraTrancheIds: string[] = []) {
  const { data: grouped } = await supabase
    .from('investment_transactions')
    .select('transaction_id')
    .eq('deposit_group_id', anchorId)
  const ids = [...new Set([anchorId, ...extraTrancheIds, ...(grouped ?? []).map((t) => t.transaction_id)])]
  await supabase.from('investment_transactions').delete().in('parent_transaction_id', ids)
  await supabase.from('investment_transactions').delete().eq('deposit_group_id', anchorId)
  await supabase.from('investment_transactions').delete().in('transaction_id', ids)
}

// Insert a withdrawal row against an existing deposit, mirroring what the
// SellWithdraw flow POSTs (transaction_type='withdrawal', linked by
// parent_transaction_id, asset_type null). Returns the created row.
export async function createWithdrawal(data: {
  parent_transaction_id: string
  amount_vnd: number
  principal_withdrawn: number
  goal_id?: string | null
  investment_date: string
  affects_progress?: boolean
}) {
  const userId = await getTestUserId()
  const { data: wd, error } = await supabase
    .from('investment_transactions')
    .insert({
      user_id: userId,
      transaction_type: 'withdrawal',
      asset_type: null,
      affects_progress: data.affects_progress ?? true,
      ...data,
    })
    .select()
    .single()
  if (error) throw error
  return wd
}

// Delete a transaction together with any withdrawal rows that reference it.
// The parent_transaction_id FK is ON DELETE SET NULL, so withdrawals would
// otherwise be orphaned (and stay attached to their goal) after the parent
// is removed.
export async function deleteTransactionCascade(txId: string) {
  await supabase.from('investment_transactions').delete().eq('parent_transaction_id', txId)
  // Renewal history snapshots link back via renewed_from_transaction_id.
  await supabase.from('investment_transactions').delete().eq('renewed_from_transaction_id', txId)
  await supabase.from('investment_transactions').delete().eq('transaction_id', txId)
}

export async function createMonthlyPlan(data: {
  month: number
  year: number
  salary_vnd: number
}) {
  const userId = await getTestUserId()
  const { data: plan, error } = await supabase
    .from('monthly_plans')
    .insert({ user_id: userId, ...data })
    .select()
    .single()
  if (error) throw error
  return plan
}

export async function deleteMonthlyPlan(planId: string) {
  await supabase.from('monthly_plans').delete().eq('id', planId)
}

export async function findGoalByName(name: string) {
  const userId = await getTestUserId()
  const { data } = await supabase.from('savings_goals').select('goal_id').eq('user_id', userId).eq('goal_name', name).single()
  return data
}


export async function findInsuranceMemberByName(name: string) {
  const userId = await getTestUserId()
  const { data } = await supabase.from('insurance_members').select('member_id').eq('user_id', userId).eq('member_name', name).single()
  return data
}

export async function findFixedExpenseByName(name: string) {
  const userId = await getTestUserId()
  const { data } = await supabase.from('fixed_expenses').select('expense_id').eq('user_id', userId).eq('expense_name', name).single()
  return data
}

export async function findMonthlyPlan(month: number, year: number) {
  const userId = await getTestUserId()
  const { data } = await supabase.from('monthly_plans').select('id').eq('user_id', userId).eq('month', month).eq('year', year).single()
  return data
}

export async function deleteAllFixedExpensesByName(name: string) {
  const userId = await getTestUserId()
  await supabase.from('fixed_expenses').delete().eq('user_id', userId).eq('expense_name', name)
}

export async function deleteAllInsuranceMembersByName(name: string) {
  const userId = await getTestUserId()
  await supabase.from('insurance_members').delete().eq('user_id', userId).eq('member_name', name)
}

export async function deleteAllTransactionsByNotes(notes: string) {
  const userId = await getTestUserId()
  await supabase.from('investment_transactions').delete().eq('user_id', userId).eq('notes', notes)
}

export async function createFund(data: {
  name: string
  code: string
  fund_type: string
  nav: number
  nav_source_url?: string
  is_dca?: boolean
  dca_monthly_amount_vnd?: number
  dca_goal_id?: string
}) {
  const userId = await getTestUserId()
  const { data: fund, error } = await supabase
    .from('funds')
    .insert({ user_id: userId, ...data })
    .select()
    .single()
  if (error) throw error
  return fund
}

export async function deleteFund(fundId: string) {
  await supabase.from('investment_transactions').delete().eq('fund_id', fundId)
  await supabase.from('funds').delete().eq('id', fundId)
}


export async function deleteFundsByNamePrefix(prefix: string) {
  const userId = await getTestUserId()
  const { data } = await supabase.from('funds').select('id').eq('user_id', userId).like('name', `${prefix}%`)
  for (const f of data ?? []) await deleteFund(f.id)
}

export async function deleteMonthlyPlanByDate(month: number, year: number) {
  const userId = await getTestUserId()
  await supabase.from('monthly_plans').delete().eq('user_id', userId).eq('month', month).eq('year', year)
}

export async function setFundDca(
  fundId: string,
  patch: { is_dca?: boolean; dca_monthly_amount_vnd?: number | null; dca_goal_id?: string | null },
) {
  await supabase.from('funds').update(patch).eq('id', fundId)
}

export async function rpcSeedPlanDca(planId: string) {
  return await supabase.rpc('seed_and_sync_plan_dca', { p_plan_id: planId })
}

export async function deletePendingDcaRows(planId: string, fundId: string) {
  const userId = await getTestUserId()
  const { error } = await supabase
    .from('investment_transactions')
    .delete()
    .eq('user_id', userId)
    .eq('plan_id', planId)
    .eq('fund_id', fundId)
    .eq('asset_type', 'fund')
    .eq('is_dca_seeded', true)
    .is('units', null)
  if (error) throw error
}

export async function getPlanDcaRows(planId: string, fundId: string) {
  const { data } = await supabase
    .from('investment_transactions')
    .select('transaction_id, amount_vnd, goal_id, is_dca_seeded, units')
    .eq('plan_id', planId)
    .eq('fund_id', fundId)
    .eq('asset_type', 'fund')
  return data ?? []
}

// Turn a pending seeded DCA row into a recorded purchase (units + unit_price),
// mirroring what happens when the user records that month's buy. is_dca_seeded
// stays true, matching the app's real recorded-DCA row.
export async function recordDcaBuy(planId: string, fundId: string, units: number, unitPrice: number) {
  await supabase
    .from('investment_transactions')
    .update({ units, unit_price: unitPrice })
    .eq('plan_id', planId)
    .eq('fund_id', fundId)
    .eq('asset_type', 'fund')
    .eq('is_dca_seeded', true)
    .is('units', null)
}

export async function countPlanDcaRows(planId: string, fundId: string): Promise<number> {
  const { count } = await supabase
    .from('investment_transactions')
    .select('transaction_id', { count: 'exact', head: true })
    .eq('plan_id', planId)
    .eq('fund_id', fundId)
    .eq('asset_type', 'fund')
  return count ?? 0
}

// Create a throwaway *second* user and a goal + fund they own, for cross-user
// ownership tests. Deleting the user (deleteForeignUser) cascades their data.
export async function createForeignOwned(): Promise<{ userId: string; goalId: string; fundId: string; txId: string; memberId: string; expenseId: string; recurringId: string }> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { data, error } = await supabase.auth.admin.createUser({
    email: `e2e-foreign-${stamp}@test.invalid`,
    password: 'TestPass123!',
    email_confirm: true,
  })
  if (error || !data.user) throw error ?? new Error('Failed to create foreign user')
  const userId = data.user.id

  const { data: goal, error: goalErr } = await supabase
    .from('savings_goals')
    .insert({ user_id: userId, goal_name: `Foreign Goal ${stamp}` })
    .select('goal_id')
    .single()
  if (goalErr || !goal) throw goalErr ?? new Error('Failed to create foreign goal')

  const { data: fund, error: fundErr } = await supabase
    .from('funds')
    .insert({ user_id: userId, name: `Foreign Fund ${stamp}`, code: `FGN${stamp.slice(-5).toUpperCase()}`, fund_type: 'equity', nav: 20000 })
    .select('id')
    .single()
  if (fundErr || !fund) throw fundErr ?? new Error('Failed to create foreign fund')

  const { data: tx, error: txErr } = await supabase
    .from('investment_transactions')
    .insert({ user_id: userId, asset_type: 'bank', transaction_type: 'investment', investment_date: '2026-01-01', amount_vnd: 5_000_000 })
    .select('transaction_id')
    .single()
  if (txErr || !tx) throw txErr ?? new Error('Failed to create foreign transaction')

  // #525 widened the guard to the plan-scoped and insurance/recurring tables, so
  // the foreign fixture needs one row of each kind to point at.
  const { data: member, error: memberErr } = await supabase
    .from('insurance_members')
    .insert({ user_id: userId, member_name: `Foreign Member ${stamp}`, relationship: 'self', annual_payment_vnd: 12_000_000 })
    .select('member_id')
    .single()
  if (memberErr || !member) throw memberErr ?? new Error('Failed to create foreign insurance member')

  const { data: expense, error: expenseErr } = await supabase
    .from('fixed_expenses')
    .insert({ user_id: userId, expense_name: `Foreign Expense ${stamp}`, amount_vnd: 1_000_000, category: 'other' })
    .select('expense_id')
    .single()
  if (expenseErr || !expense) throw expenseErr ?? new Error('Failed to create foreign fixed expense')

  const { data: recurring, error: recurringErr } = await supabase
    .from('recurring_savings')
    .insert({ user_id: userId, name: `Foreign Recurring ${stamp}`, amount_vnd: 1_000_000 })
    .select('saving_id')
    .single()
  if (recurringErr || !recurring) throw recurringErr ?? new Error('Failed to create foreign recurring saving')

  return {
    userId,
    goalId: goal.goal_id,
    fundId: fund.id,
    txId: tx.transaction_id,
    memberId: member.member_id,
    expenseId: expense.expense_id,
    recurringId: recurring.saving_id,
  }
}

export async function deleteForeignUser(userId: string) {
  await supabase.auth.admin.deleteUser(userId)
}
