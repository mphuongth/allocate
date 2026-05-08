import { createClient } from '@supabase/supabase-js'
import path from 'path'
import fs from 'fs'

const USER_FILE = path.join(__dirname, '..', '.auth', 'user.json')

const supabase = createClient(
  process.env.E2E_SUPABASE_URL!,
  process.env.E2E_SUPABASE_SERVICE_ROLE_KEY!
)

let _testUserId: string | null = null

export async function getTestUserId(): Promise<string> {
  if (_testUserId) return _testUserId
  const { userId } = JSON.parse(fs.readFileSync(USER_FILE, 'utf-8'))
  _testUserId = userId
  return _testUserId
}

export async function createGoal(data: { goal_name: string; target_amount?: number }) {
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

export async function findTransactionLast(assetType: string) {
  const userId = await getTestUserId()
  const { data } = await supabase.from('investment_transactions').select('transaction_id').eq('user_id', userId).eq('asset_type', assetType).order('created_at', { ascending: false }).limit(1).single()
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

export async function getFirstFund() {
  const userId = await getTestUserId()
  const { data, error } = await supabase
    .from('funds')
    .select('id, name, code, nav, fund_type')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()
  if (error) return null
  return data
}
