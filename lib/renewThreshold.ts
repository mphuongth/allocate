// The deposit rate (%/yr) at or above which a maturing term deposit is
// suggested for renewal — principal and interest rolled into a new cycle —
// and below which it is suggested for a move into its target fund. The user's
// own value lives in user_settings.renew_min_rate_pct; NULL ("not chosen") is
// answered with this default. The app only suggests: the user confirms.
export const DEFAULT_RENEW_MIN_RATE_PCT = 8

/** The user's threshold, or the default when they have not chosen one. 0 is a choice. */
export function resolveRenewThreshold(stored: number | null | undefined): number {
  return stored ?? DEFAULT_RENEW_MIN_RATE_PCT
}

/**
 * The suggestion for a maturing deposit, given today's 12-month rate: renew
 * principal + interest at or above the threshold, move to the target fund
 * below it. Compared in hundredths of a percent, so a typed 8 is never read as
 * 7.999… by floating point.
 */
export function suggestMaturityAction(currentRatePct: number, thresholdPct: number): 'renew' | 'move' {
  return Math.round(currentRatePct * 100) >= Math.round(thresholdPct * 100) ? 'renew' : 'move'
}
