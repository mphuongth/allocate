// Shared parsing for the fund create/update payload. POST /api/funds and
// PUT /api/funds/[id] validated the same fields with identical copies, so a rule
// could be tightened on one and missed on the other (#572).
//
// The routes keep what genuinely differs: their DB writes, and the disable-DCA
// RPC path. The one behavioural difference in *parsing* is explicit in `mode` —
// create always produces DCA fields, update produces them only when the caller
// sends `is_dca`.

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ValidationError, validateAmount } from '@/lib/validation'
import { isFundCodePriceable, normalizeFundCode } from '@/lib/fmarket-nav'

export const FUND_TYPES = ['balanced', 'equity', 'debt', 'gold'] as const
export type FundType = (typeof FUND_TYPES)[number]

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The always-written columns, normalized and ready to store. */
export interface FundFields {
  name: string
  code: string
  fund_type: FundType
  nav: number
  /**
   * Absent on an update that didn't send the flag — the column is then left
   * alone rather than written. Silently switching automatic pricing off because
   * a caller omitted a field is the #590 failure mode (a write that wipes
   * configuration the user never touched), so omission means "unchanged", not
   * "off". On create it is always present.
   */
  nav_auto_sync?: boolean
}

/** The DCA columns. `null` in a result means "not sent" — leave them alone. */
export interface DcaFields {
  is_dca: boolean
  dca_monthly_amount_vnd: number | null
  dca_goal_id: string | null
}

export type FundPayloadResult<Dca extends DcaFields | null = DcaFields | null> =
  | { ok: true; fund: FundFields; dca: Dca }
  | { ok: false; response: NextResponse }

const badRequest = (error: string) => NextResponse.json({ error }, { status: 400 })

// Overloaded so the mode carries the invariant: create always produces DCA
// fields, update produces them only when the caller sent is_dca. Without this
// the create route would need a non-null assertion on every use.
export function parseFundPayload(body: Record<string, unknown>, mode: 'create'): FundPayloadResult<DcaFields>
export function parseFundPayload(body: Record<string, unknown>, mode: 'update'): FundPayloadResult<DcaFields | null>
// For callers holding the mode in a variable, e.g. a test driving both.
export function parseFundPayload(body: Record<string, unknown>, mode: 'create' | 'update'): FundPayloadResult
export function parseFundPayload(
  body: Record<string, unknown>,
  mode: 'create' | 'update',
): FundPayloadResult {
  const { name, code, fund_type, nav, nav_auto_sync, is_dca, dca_monthly_amount_vnd, dca_goal_id } = body

  // Update rejects a non-boolean is_dca because the value decides whether the
  // DCA columns are written at all; create treats anything but `true` as off.
  // Asymmetric, and preserved deliberately — changing it is a behaviour change.
  if (mode === 'update' && is_dca !== undefined && typeof is_dca !== 'boolean') {
    return { ok: false, response: badRequest('is_dca must be a boolean') }
  }

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return { ok: false, response: badRequest('Name is required') }
  }
  if (name.trim().length > 255) {
    return { ok: false, response: badRequest('Name must be 255 characters or less') }
  }
  if (!code || typeof code !== 'string' || code.trim().length === 0) {
    return { ok: false, response: badRequest('Code is required') }
  }
  if (code.trim().length > 50) {
    return { ok: false, response: badRequest('Code must be 50 characters or less') }
  }
  if (!fund_type || !FUND_TYPES.includes(fund_type as FundType)) {
    return { ok: false, response: badRequest('Fund type is required') }
  }

  const navNum = Number(nav)
  // Number('Infinity') is Infinity and would slip past a bare `< 0.01` check —
  // require a finite value so it can't reach the DB numeric column.
  if (!Number.isFinite(navNum) || navNum < 0.01) {
    return { ok: false, response: badRequest('NAV must be greater than 0') }
  }
  if (dca_goal_id != null && dca_goal_id !== '' && (typeof dca_goal_id !== 'string' || !UUID_RE.test(dca_goal_id))) {
    return { ok: false, response: badRequest('Invalid goal') }
  }

  // Whether this fund is priced automatically from the upstream feed.
  if (nav_auto_sync !== undefined && typeof nav_auto_sync !== 'boolean') {
    return { ok: false, response: badRequest('nav_auto_sync must be a boolean') }
  }

  const fund: FundFields = {
    name: name.trim(),
    code: code.trim().toUpperCase(),
    fund_type: fund_type as FundType,
    nav: navNum,
  }

  // Create defaults to off; update writes the column only when the flag was
  // actually sent, so a partial write can't turn someone's sync off behind them.
  if (mode === 'create' || nav_auto_sync !== undefined) {
    fund.nav_auto_sync = nav_auto_sync === true
  }

  // Partial-update semantics: the Add/Edit form omits the DCA fields, so a
  // name/NAV edit must preserve the existing config rather than wipe it. The
  // toggle/amount/goal handlers always send is_dca, so they're unaffected.
  if (mode === 'update' && is_dca === undefined) return { ok: true, fund, dca: null }

  const enabled = is_dca === true
  let amount: number | null = null
  // Checked by *presence*, not truthiness, so a sent 0 is rejected rather than
  // silently stored as null — a positive, whole (BIGINT) amount, else a 400
  // instead of a DB CHECK / type error (500). Absent leaves it null (DCA on,
  // amount not yet set).
  if (enabled && dca_monthly_amount_vnd != null && dca_monthly_amount_vnd !== '') {
    try {
      amount = validateAmount(dca_monthly_amount_vnd, 'dca_monthly_amount_vnd', { positive: true, integer: true })
    } catch (e) {
      if (e instanceof ValidationError) return { ok: false, response: badRequest(e.message) }
      throw e
    }
  }

  return {
    ok: true,
    fund,
    dca: {
      is_dca: enabled,
      dca_monthly_amount_vnd: amount,
      // Goal target only applies while DCA is on; cleared otherwise.
      dca_goal_id: enabled && dca_goal_id ? (dca_goal_id as string) : null,
    },
  }
}

/**
 * A valid-looking UUID isn't proof of ownership: verify the DCA goal is the
 * caller's before linking it, so a known foreign goal_id can't be attached
 * (#474). Returns the response to send when it isn't, or null to proceed.
 */
export async function dcaGoalOwnershipError(
  supabase: SupabaseClient,
  goalId: string,
  userId: string,
): Promise<NextResponse | null> {
  const { data: goal } = await supabase
    .from('savings_goals')
    .select('goal_id, completed_at')
    .eq('goal_id', goalId)
    .eq('user_id', userId)
    .single()

  if (!goal) {
    return NextResponse.json({ error: "You don't have permission to access this goal." }, { status: 403 })
  }
  // A DCA plan buys into its goal every month, so pointing one at an archived
  // goal is money flowing into a result already declared final (#650). The
  // database refuses it too; this is the readable half.
  if (goal.completed_at) {
    return NextResponse.json(
      { error: 'This goal has been finished, so it takes no new money. Reopen it first.', code: 'goal_completed' },
      { status: 409 },
    )
  }
  return null
}

/**
 * Refuse to switch automatic pricing on for a code the upstream feed cannot
 * price. `funds.code` is what the refresh routes match on, so an unlisted code
 * means a fund that shows a sync toggle and then silently never updates —
 * failure discovered days later, at the next refresh, with no obvious cause.
 *
 * Guards a *transition*, not a state. `previous` is the fund as stored; passing
 * it means "already-on-and-unchanged is none of this check's business". Without
 * that, every DCA amount, goal and disable write would be gated too: those all
 * PUT the fund's current `nav_auto_sync: true` back, so a fund whose code the
 * feed happens not to list — including an opt-in migrated from the old
 * nav_source_url, which was never checked against anything — would answer 400 to
 * edits that have nothing to do with pricing. It also keeps the upstream request
 * on deliberate actions (create, enable, rename the code) rather than on every
 * save.
 *
 * Fails OPEN when the feed can't be reached. An outage is not evidence about the
 * code, and must not stand between someone and editing their own fund — the
 * worst case is a fund saved with sync on that reports a per-fund error at the
 * next refresh, which is exactly the state it would be in anyway.
 */
export async function unpriceableFundCodeError(
  fields: FundFields,
  previous?: { code: string; nav_auto_sync: boolean } | null,
): Promise<NextResponse | null> {
  // The flag as it will be AFTER this write, not as it was sent. An update that
  // omits it keeps the stored value (see FundFields), so "absent" is not "off":
  // reading the sent value alone let a rename slip through on an already-synced
  // fund, writing an unlisted code that then failed every refresh in silence.
  const willSync = fields.nav_auto_sync ?? previous?.nav_auto_sync ?? false
  if (!willSync) return null

  // Already on, and the code isn't moving: this write changes nothing the check
  // is about.
  if (
    previous?.nav_auto_sync === true &&
    normalizeFundCode(previous.code) === normalizeFundCode(fields.code)
  ) {
    return null
  }

  const priceable = await isFundCodePriceable(fields.code)
  if (priceable === false) {
    return badRequest(
      `Automatic NAV updates need a fund code the price feed lists. "${fields.code}" isn't one — check the code, or turn automatic updates off.`,
    )
  }
  return null
}
