import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateUUID } from '@/lib/validation'
import { isPlanMonthRealized } from '@/lib/finance'

type HistoryEntry = {
  id: string
  amount: number
  date: string          // YYYY-MM-DD
  kind: 'logged' | 'plan'
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let memberId: string
  try {
    memberId = validateUUID(id, 'member_id')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Member (for the default monthly contribution), manual savings, and the
  // user's monthly plans (which auto-accrue toward each member). These three
  // sources must reconcile with the dashboard's "Saved" amount, which is
  // computed identically in app/api/v1/dashboard/overview/route.ts.
  const [memberRes, savingsRes, plansRes] = await Promise.all([
    supabase
      .from('insurance_members')
      .select('annual_payment_vnd, user_id')
      .eq('member_id', memberId)
      .single(),
    supabase
      .from('insurance_savings')
      .select('id, amount_saved_vnd, saved_date, created_at')
      .eq('insurance_member_id', memberId)
      .eq('user_id', user.id),
    supabase
      .from('monthly_plans')
      .select('id, month, year')
      .eq('user_id', user.id),
  ])

  if (memberRes.error || !memberRes.data) return NextResponse.json({ error: 'Insurance member not found' }, { status: 404 })
  if (memberRes.data.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (savingsRes.error) return NextResponse.json({ error: 'Failed to fetch savings' }, { status: 500 })

  const annualPremium = memberRes.data.annual_payment_vnd ?? 0
  const defaultMonthly = Math.round(annualPremium / 12)
  const plans = plansRes.data ?? []
  const planIds = plans.map((p) => p.id)

  const [exclRes, ovrRes] = await Promise.all([
    planIds.length > 0
      ? supabase.from('plan_excluded_insurance_members').select('plan_id, member_id').in('plan_id', planIds)
      : Promise.resolve({ data: [] as { plan_id: string; member_id: string }[] }),
    planIds.length > 0
      ? supabase.from('plan_insurance_member_overrides').select('plan_id, member_id, monthly_amount_override_vnd').in('plan_id', planIds)
      : Promise.resolve({ data: [] as { plan_id: string; member_id: string; monthly_amount_override_vnd: number }[] }),
  ])

  const excludedSet = new Set((exclRes.data ?? []).map((e) => `${e.plan_id}::${e.member_id}`))
  const overrideMap = new Map((ovrRes.data ?? []).map((o) => [`${o.plan_id}::${o.member_id}`, o.monthly_amount_override_vnd]))

  const entries: HistoryEntry[] = []

  // Manually logged payments
  for (const s of (savingsRes.data ?? [])) {
    entries.push({
      id: s.id,
      amount: Number(s.amount_saved_vnd ?? 0),
      date: String(s.saved_date ?? s.created_at ?? '').slice(0, 10),
      kind: 'logged',
    })
  }

  // Auto-accrued monthly contribution from each (non-excluded) plan whose month
  // has arrived. Future months are budgeted, not yet saved, so they're excluded
  // to reconcile with the dashboard's real "Saved" amount.
  for (const p of plans) {
    if (excludedSet.has(`${p.id}::${memberId}`)) continue
    if (!isPlanMonthRealized(p.year, p.month)) continue
    entries.push({
      id: `plan-${p.id}`,
      amount: Number(overrideMap.get(`${p.id}::${memberId}`) ?? defaultMonthly),
      date: `${p.year}-${String(p.month).padStart(2, '0')}-01`,
      kind: 'plan',
    })
  }

  entries.sort((a, b) => b.date.localeCompare(a.date))
  const totalSaved = entries.reduce((sum, e) => sum + e.amount, 0)

  return NextResponse.json({ entries, totalSaved })
}
