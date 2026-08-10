// Write model for the maturity-resolve flow (#467): the new principal and the
// renew/collapse request body, per resolution mode. Extracted from
// MaturityResolveBody so the money that persists lives in one tested place; the
// component keeps the form state, validation UI, and fetch/error handling.
import { renewalPrincipal, type RenewMode } from '@/lib/maturity'

export type Mode = RenewMode | 'withdraw' | 'combine'

export interface RenewSource {
  id: string
  name?: string | null
}

// A matured deposit's new principal for the chosen resolution: unchanged on
// withdraw; the re-deposit plus everything folded in on combine; else the renewal
// rule (principal, principal+interest, or a manual new amount).
export function computeNewPrincipal(mode: Mode, args: {
  principal: number
  iNum: number
  newAmountNum: number | null
  redepositNum: number
  mergeReceivedTotal: number
  heldReceivedTotal: number
}): number {
  if (mode === 'withdraw') return args.principal
  if (mode === 'combine') return args.redepositNum + args.mergeReceivedTotal + args.heldReceivedTotal
  return renewalPrincipal(mode, args.principal, args.iNum, args.newAmountNum)
}

// A book collapses all tranches into one fresh deposit via /collapse; a single
// term deposit rolls forward via /renew.
export function renewEndpoint(isBook: boolean): 'collapse' | 'renew' {
  return isBook ? 'collapse' : 'renew'
}

// The renew/collapse POST body. Combine sends the BASE re-deposit (the RPC adds
// the received cash itself, so client and server can't disagree); every other path
// sends the full new principal. A book's collapse route derives per-tranche
// realized interest, so interest_earned_vnd is only sent for /renew.
export function buildRenewBody(args: {
  mode: Mode
  isBook: boolean
  newPrincipal: number
  redepositNum: number
  rate: string
  newMaturity: string
  baseDate: string
  iNum: number
  pickedCand: { saving_id: string } | null
  markFulfilled: boolean
  fulfillYm: string
  linkedAmt: number
  selectedSources: RenewSource[]
  mergeRecv: Record<string, string>
  destBank: string
  /** The bank the deposit sits at today — `bank_code` is sent only when it moves. */
  currentBank: string
  selectedHeld: RenewSource[]
}): Record<string, unknown> {
  const {
    mode, isBook, newPrincipal, redepositNum, rate, newMaturity, baseDate, iNum,
    pickedCand, markFulfilled, fulfillYm, linkedAmt, selectedSources, mergeRecv, destBank, currentBank, selectedHeld,
  } = args
  const isCombine = mode === 'combine'
  // The new cycle can be placed at a different bank — on any renewal, not only
  // when siblings are folded in. Gating this on merge sources left a lone
  // maturing deposit no way to change bank at all (#640). Sent only when it
  // actually moves: the RPC reads null as "leave the bank as is", so an empty
  // pick can't clear one, and an unchanged pick would needlessly route a plain
  // renewal through the merge function. A book collapses via a route that takes
  // no bank, and a withdrawal opens no new cycle to place.
  const movesBank = !isBook && mode !== 'withdraw' && !!destBank && destBank !== currentBank
  return {
    amount_vnd: isCombine ? Math.round(redepositNum) : Math.round(newPrincipal),
    interest_rate: Number(rate),
    expiry_date: newMaturity,
    investment_date: baseDate,
    ...(isBook ? {} : { interest_earned_vnd: iNum }),
    fulfill_recurring: isCombine && pickedCand && markFulfilled
      ? { saving_id: pickedCand.saving_id, ym: fulfillYm, amount: linkedAmt }
      : undefined,
    merge_sources: isCombine && selectedSources.length > 0
      ? selectedSources.map((s) => ({ tx_id: s.id, received: Math.round(Number(mergeRecv[s.id]) || 0) }))
      : undefined,
    bank_code: movesBank ? destBank : undefined,
    held_sources: isCombine && selectedHeld.length > 0 ? selectedHeld.map((h) => h.id) : undefined,
  }
}
