import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { ValidationError, validateAmount, validateUUID } from '@/lib/validation'
import { ownershipError } from '@/lib/assertOwned'
import { readJsonBody } from '@/lib/apiBody'
import type { SupabaseClient } from '@supabase/supabase-js'

// Monthly-plan overrides, as one implementation with three registrations (#690).
//
// There were three parallel route families — fixed expenses, recurring savings,
// insurance members — each repeating UUID parsing, auth, the owned-plan lookup,
// the referenced-resource ownership check, the upsert and the scoped delete.
// That is security-sensitive duplication: plan scoping and ownership have to
// stay identical, and a fourth family has to inherit them rather than remember
// them.
//
// They had already drifted. The insurance family was copied without its DELETE
// (#467 added it a release later, so "restore member" silently 404'd), its GET
// returned null instead of an empty list, and it skipped the ordering the other
// two apply.
//
// Every table and column below is a fixed string in this module. Nothing about
// the query shape comes from the request — a client supplies an id and an
// amount, never a table or a column.

export type OverrideFamily = {
  /** The override table. */
  table: string
  /** The body field naming the overridden resource — also the FK column. */
  bodyField: string
  /** The referenced resource, for the ownership check. */
  refTable: string
  refPk: string
  /** How the referenced resource is named in a 403. */
  refLabel: string
  /** What GET returns. */
  projection: string
  /** Whether the table has an updated_at to stamp. */
  stampsUpdatedAt: boolean
  /**
   * The family's own amount rule. Resource-specific on purpose: zeroing an
   * expense for a month is an ordinary plan edit, while a zero insurance premium
   * means the member does not belong in the plan at all. Throws ValidationError.
   */
  readAmount: (raw: unknown) => number
}

/** Shared by the two families whose override may legitimately be zero. */
function amountAllowingZero(raw: unknown): number {
  if (raw === undefined || raw === null) {
    throw new ValidationError('Monthly amount must be 0 or positive')
  }
  return validateAmount(raw, 'monthly_amount_override_vnd')
}

export const FIXED_EXPENSE_OVERRIDES: OverrideFamily = {
  table: 'fixed_expense_overrides',
  bodyField: 'fixed_expense_id',
  refTable: 'fixed_expenses',
  refPk: 'expense_id',
  refLabel: 'expense',
  projection: '*, fixed_expenses(expense_name, amount_vnd)',
  stampsUpdatedAt: true,
  readAmount: amountAllowingZero,
}

export const RECURRING_SAVING_OVERRIDES: OverrideFamily = {
  table: 'recurring_saving_overrides',
  bodyField: 'recurring_saving_id',
  refTable: 'recurring_savings',
  refPk: 'saving_id',
  refLabel: 'recurring saving',
  projection: '*, recurring_savings(name, amount_vnd)',
  stampsUpdatedAt: true,
  readAmount: amountAllowingZero,
}

export const INSURANCE_OVERRIDES: OverrideFamily = {
  table: 'plan_insurance_member_overrides',
  bodyField: 'member_id',
  refTable: 'insurance_members',
  refPk: 'member_id',
  refLabel: 'insurance member',
  projection: 'id, member_id, monthly_amount_override_vnd',
  // The only real difference between the families: this table has no updated_at
  // column, so stamping one would fail the write.
  stampsUpdatedAt: false,
  readAmount: (raw) => {
    const amount = validateAmount(raw, 'monthly_amount_override_vnd')
    if (amount <= 0) throw new ValidationError('Monthly amount must be positive')
    return amount
  },
}

function badRequest(e: unknown): NextResponse | null {
  return e instanceof ValidationError ? NextResponse.json({ error: e.message }, { status: 400 }) : null
}

/**
 * Authenticate, then find the plan as the caller's. Discriminated on `ok`, the
 * same shape readJsonBody uses, so a caller cannot read `planId` without having
 * checked. The one place plan scoping is expressed — no family can look a plan
 * up unscoped.
 */
type OwnedPlan =
  | { ok: false; response: NextResponse }
  | { ok: true; supabase: SupabaseClient; user: { id: string }; planId: string }

async function requireOwnedPlan(rawPlanId: string): Promise<OwnedPlan> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  let planId: string
  try {
    planId = validateUUID(rawPlanId, 'plan_id')
  } catch (e) {
    const bad = badRequest(e)
    if (bad) return { ok: false, response: bad }
    throw e
  }

  const { data: plan } = await supabase
    .from('monthly_plans')
    .select('id')
    .eq('id', planId)
    .eq('user_id', user.id)
    .single()
  if (!plan) return { ok: false, response: NextResponse.json({ error: 'Plan not found' }, { status: 404 }) }

  return { ok: true, supabase, user, planId }
}

export function overrideCollectionRoutes(family: OverrideFamily) {
  async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
    const { id } = await params
    const owned = await requireOwnedPlan(id)
    if (!owned.ok) return owned.response
    const { supabase, planId } = owned

    const { data, error } = await supabase
      .from(family.table)
      .select(family.projection)
      .eq('plan_id', planId)
      // Ordered in every family: an unordered list is a response that can change
      // between identical requests.
      .order('created_at', { ascending: true })

    if (error) return NextResponse.json({ error: 'Failed to fetch overrides' }, { status: 500 })
    // Never null — a caller mapping over the body should not have to guard.
    return NextResponse.json(data ?? [])
  }

  async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
    const { id } = await params
    const owned = await requireOwnedPlan(id)
    if (!owned.ok) return owned.response
    const { supabase, user, planId } = owned

    const parsed = await readJsonBody(request)
    if (!parsed.ok) return parsed.response

    let refId: string
    let amount: number
    try {
      const raw = parsed.body[family.bodyField]
      if (!raw) throw new ValidationError(`${family.bodyField} is required`)
      refId = validateUUID(raw, family.bodyField)
      amount = family.readAmount(parsed.body.monthly_amount_override_vnd)
    } catch (e) {
      const bad = badRequest(e)
      if (bad) return bad
      throw e
    }

    // The referenced record must belong to the plan's owner too. A valid UUID
    // isn't proof of ownership, and the DB trigger that enforces this (#525)
    // fires mid-write — checking here turns that into a clear 403.
    const ownErr = await ownershipError(supabase, family.refTable, family.refPk, refId, user.id, family.refLabel)
    if (ownErr) return ownErr

    // One override per resource per plan.
    const { data, error } = await supabase
      .from(family.table)
      .upsert(
        {
          plan_id: planId,
          [family.bodyField]: refId,
          monthly_amount_override_vnd: amount,
          ...(family.stampsUpdatedAt ? { updated_at: new Date().toISOString() } : {}),
        },
        { onConflict: `plan_id,${family.bodyField}` },
      )
      .select()
      .single()

    if (error) return NextResponse.json({ error: 'Failed to save override' }, { status: 500 })
    return NextResponse.json(data, { status: 201 })
  }

  return { GET, POST }
}

export function overrideItemRoutes(family: OverrideFamily) {
  async function DELETE(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string; overrideId: string }> },
  ): Promise<NextResponse> {
    const { id, overrideId } = await params
    const owned = await requireOwnedPlan(id)
    if (!owned.ok) return owned.response
    const { supabase, planId } = owned

    let cleanOverrideId: string
    try {
      cleanOverrideId = validateUUID(overrideId, 'override_id')
    } catch (e) {
      const bad = badRequest(e)
      if (bad) return bad
      throw e
    }

    // Scoped by plan as well as by id: without it an override id from another
    // plan — including another user's — would be deletable through a plan the
    // caller does own.
    const { error } = await supabase
      .from(family.table)
      .delete()
      .eq('id', cleanOverrideId)
      .eq('plan_id', planId)

    if (error) return NextResponse.json({ error: 'Override not found' }, { status: 404 })
    // Idempotent: the caller asked for it to be gone, and it is gone.
    return new NextResponse(null, { status: 204 })
  }

  return { DELETE }
}
