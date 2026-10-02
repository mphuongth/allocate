// The deposit rate (%/yr) at or above which a maturing term deposit is
// suggested for renewal — principal and interest rolled into a new cycle —
// and below which it is suggested for a move into its target fund. The user's
// own value lives in user_settings.renew_min_rate_pct; NULL ("not chosen") is
// answered with this default. The app only suggests: the user confirms.
export const DEFAULT_RENEW_MIN_RATE_PCT = 8
