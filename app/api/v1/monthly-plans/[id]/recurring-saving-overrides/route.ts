import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateUUID } from '@/lib/validation'
import { ownershipError } from '@/lib/assertOwned'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let planId: string
  try {
    planId = validateUUID(id, 'plan_id')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: plan } = await supabase.from('monthly_plans').select('id').eq('id', planId).eq('user_id', user.id).single()
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  const { data, error } = await supabase
    .from('recurring_saving_overrides')
    .select('*, recurring_savings(name, amount_vnd)')
    .eq('plan_id', planId)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: 'Failed to fetch overrides' }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { recurring_saving_id, monthly_amount_override_vnd } = body

  let planId: string
  let cleanSavingId: string
  let cleanAmount: number
  try {
    planId = validateUUID(id, 'plan_id')
    if (!recurring_saving_id) throw new ValidationError('recurring_saving_id is required')
    cleanSavingId = validateUUID(recurring_saving_id, 'recurring_saving_id')
    if (monthly_amount_override_vnd === undefined || monthly_amount_override_vnd === null) {
      throw new ValidationError('Monthly amount must be 0 or positive')
    }
    cleanAmount = validateAmount(monthly_amount_override_vnd, 'monthly_amount_override_vnd')
  } catch (e) {
    if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
    throw e
  }

  const { data: plan } = await supabase.from('monthly_plans').select('id').eq('id', planId).eq('user_id', user.id).single()
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

  // The referenced record must belong to the plan's owner too. A valid UUID
  // isn't proof of ownership, and the DB trigger that enforces this (#525)
  // fires mid-write — checking here turns that into a clear 403.
  const ownErr = await ownershipError(supabase, 'recurring_savings', 'saving_id', cleanSavingId, user.id, 'recurring saving')
  if (ownErr) return ownErr

  // Upsert — one override per recurring saving per plan
  const { data, error } = await supabase
    .from('recurring_saving_overrides')
    .upsert(
      { plan_id: planId, recurring_saving_id: cleanSavingId, monthly_amount_override_vnd: cleanAmount, updated_at: new Date().toISOString() },
      { onConflict: 'plan_id,recurring_saving_id' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: 'Failed to save override' }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
