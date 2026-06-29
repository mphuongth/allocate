// Duration of the brief "success" confirmation flash before a maturity/assign
// sheet auto-closes and the dashboard refreshes. Long enough to register the
// checkmark, short enough that the UI doesn't feel blocked — the previous
// 1.7–2s waits read as a stall (you'd sit watching a done checkmark, and the
// dashboard took 2s to reflect an assignment). Kept in one place so the assign
// flow's modal flash and the dashboard refresh stay coordinated: the refresh
// fires as the flash ends, so the unallocated row never unmounts mid-animation.
export const SUCCESS_FLASH_MS = 800
