import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateDate, validateRate, validateUUID } from '@/lib/validation'
import { isFutureInvestmentDate, MATURITY_ANCHOR_GRACE_DAYS } from '@/lib/dates'
import { buildCollapsePlan, type CollapseTrancheInput } from '@/lib/accumulating'
import { readJsonBody } from '@/lib/apiBody'

// Collapse an accumulating ("Loại 2") book at maturity into ONE fresh term
// deposit (the book-level renewal). `id` is the deposit_group_id (= the anchor
// row's transaction_id).
//
// The book's tranches each carry their own locked rate, so the interest of each
// closed cycle is valued HERE with lib/finance's single formula (capped at the
// shared maturity) and passed per-tranche to collapse_accumulating_book, which
// writes it onto that tranche's history snapshot. Keeping the formula in TS — the
// same one buildInvRows/the dashboard use — is deliberate: there is exactly one
// interest source of truth and the SQL never re-derives it. The route only reads
// and computes; the coupled writes (snapshot every tranche, re-parent its
// withdrawals, roll the anchor forward, delete the rest, optionally fold in a
// recurring saving) all run atomically inside the RPC.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await readJsonBody(request)
  if (!parsed.ok) return parsed.response
  const body = parsed.body
  const { amount_vnd, interest_rate, expiry_date, investment_date, fulfill_recurring } = body

  let groupId: string
  let cleanAmount: number
  let cleanRate: number | null = null
  let cleanExpiry: string | null = null
  let cleanInvestmentDate: string
  let cleanFulfillSavingId: string | null = null
  let cleanFulfillYm: string | null = null
  let cleanFulfillAmount: number | null = null
  try {
    groupId = validateUUID(id, 'group_id')
    cleanAmount = validateAmount(amount_vnd, 'amount_vnd')
    if (cleanAmount <= 0) throw new ValidationError('amount_vnd must be positive')
    if (interest_rate != null && interest_rate !== '') cleanRate = validateRate(interest_rate, 'interest_rate')
    if (expiry_date) cleanExpiry = validateDate(expiry_date, 'expiry_date')
    cleanInvestmentDate = validateDate(investment_date, 'investment_date')
    if (fulfill_recurring != null) {
      cleanFulfillSavingId = validateUUID(fulfill_recurring.saving_id, 'fulfill_recurring.saving_id')
      if (typeof fulfill_recurring.ym !== 'string' || !/^\d{4}-\d{2}$/.test(fulfill_recurring.ym)) {
        throw new ValidationError('fulfill_recurring.ym must be a YYYY-MM month')
      }
      cleanFulfillYm = fulfill_recurring.ym
      const a = Number(fulfill_recurring.amount ?? 0)
      if (!Number.isFinite(a) || a < 0) throw new ValidationError('fulfill_recurring.amount must be a non-negative number')
      cleanFulfillAmount = Math.round(a)
    }
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  // Same maturity anchor as renew: the book's old maturity can be a day out (#591).
  if (isFutureInvestmentDate(cleanInvestmentDate, new Date(), MATURITY_ANCHOR_GRACE_DAYS)) {
    return NextResponse.json({ error: 'Investment date cannot be in the future.' }, { status: 400 })
  }
  // The new cycle must have positive length (ISO date strings sort chronologically).
  if (cleanExpiry && cleanExpiry <= cleanInvestmentDate) {
    return NextResponse.json({ error: 'New maturity must be after the investment date.' }, { status: 400 })
  }

  // The anchor must be a real accumulating book owned by this user (the row whose
  // group = its own id). The RPC re-checks under FOR UPDATE; this is the friendly 4xx.
  const { data: anchor, error: anchorErr } = await supabase
    .from('investment_transactions')
    .select('asset_type, deposit_group_id')
    .eq('transaction_id', groupId)
    .eq('user_id', user.id)
    .single()
  if (anchorErr || !anchor) return NextResponse.json({ error: 'Deposit not found' }, { status: 404 })
  if (anchor.asset_type !== 'bank' || anchor.deposit_group_id !== groupId) {
    return NextResponse.json({ error: 'Only an accumulating book can be collapsed.' }, { status: 400 })
  }

  // Read every live tranche of the book plus any partial withdrawals on them, so
  // we value each tranche on its EFFECTIVE (post-withdrawal) principal — a
  // withdrawal that spanned a tranche is netted before interest is computed.
  const { data: tranches, error: trErr } = await supabase
    .from('investment_transactions')
    .select('transaction_id, amount_vnd, interest_rate, investment_date, expiry_date')
    .eq('user_id', user.id)
    .eq('deposit_group_id', groupId)
    .eq('transaction_type', 'investment')
    .is('renewed_from_transaction_id', null)
  if (trErr || !tranches || tranches.length === 0) {
    return NextResponse.json({ error: 'Book has no tranches to collapse.' }, { status: 400 })
  }

  const trancheIds = tranches.map((t) => t.transaction_id)
  const { data: withdrawals, error: wdErr } = await supabase
    .from('investment_transactions')
    .select('parent_transaction_id, principal_withdrawn')
    .eq('user_id', user.id)
    .eq('transaction_type', 'withdrawal')
    .in('parent_transaction_id', trancheIds)
  // A failed read and a book with no withdrawals both arrive as an empty list,
  // and the difference is the whole valuation: netting nothing leaves every
  // tranche at its ORIGINAL principal, so the interest below is computed on
  // money that is no longer in the deposit. Stop here rather than hand an
  // inflated figure to the RPC — this route WRITES, and the snapshot it
  // persists becomes permanent financial history that no retry undoes (#527).
  if (wdErr) {
    console.error('collapse: failed to read partial withdrawals', wdErr.message)
    return NextResponse.json({ error: 'Failed to collapse book' }, { status: 500 })
  }
  const wdByParent = new Map<string, number>()
  for (const w of withdrawals ?? []) {
    if (!w.parent_transaction_id) continue
    wdByParent.set(w.parent_transaction_id, (wdByParent.get(w.parent_transaction_id) ?? 0) + (w.principal_withdrawn ?? 0))
  }

  const planInput: CollapseTrancheInput[] = tranches.map((t) => ({
    id: t.transaction_id,
    principal: Math.max(0, t.amount_vnd - (wdByParent.get(t.transaction_id) ?? 0)),
    rate: t.interest_rate ?? null,
    investmentDate: t.investment_date,
    expiryDate: t.expiry_date ?? null,
  }))
  const plan = buildCollapsePlan(planInput)

  const { data: collapsed, error: rpcErr } = await supabase
    .rpc('collapse_accumulating_book', {
      p_group_id: groupId,
      p_amount_vnd: Math.round(cleanAmount),
      p_interest_rate: cleanRate,
      p_expiry_date: cleanExpiry,
      p_investment_date: cleanInvestmentDate,
      p_tranche_ids: plan.tranches.map((t) => t.id),
      p_tranche_interest: plan.tranches.map((t) => t.interest),
      p_fulfill_saving_id: cleanFulfillSavingId,
      p_fulfill_ym: cleanFulfillYm,
      p_fulfill_amount: cleanFulfillAmount,
      p_fulfill_source: cleanFulfillSavingId ? 'maturity-collapse' : null,
    })
    .single()
  if (rpcErr || !collapsed) {
    // The book changed between our read and the RPC (e.g. a top-up landed) — the
    // RPC aborted rather than drop the new tranche. Tell the client to reload.
    if (rpcErr?.message?.includes('book changed since load')) {
      return NextResponse.json({ error: 'This deposit changed — please reload and try again.' }, { status: 409 })
    }
    console.error('collapse: atomic collapse failed', rpcErr?.message)
    return NextResponse.json({ error: 'Failed to collapse book' }, { status: 500 })
  }

  return NextResponse.json(collapsed)
}
