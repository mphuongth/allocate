// Duration of the brief "success" confirmation flash before a maturity/assign
// sheet auto-closes and the dashboard refreshes. Long enough to register the
// checkmark, short enough that the UI doesn't feel blocked — the previous
// 1.7–2s waits read as a stall (you'd sit watching a done checkmark, and the
// dashboard took 2s to reflect an assignment).
//
// The sheet that shows a flash also owns when it ends, and asks for the refresh
// at that moment — the refresh unmounts the row it is animating, so two timers
// of this length on either side of that boundary raced (#567). This constant is
// the flash duration, not a coordination mechanism between components.
export const SUCCESS_FLASH_MS = 800
