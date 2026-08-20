import { RECURRING_SAVING_OVERRIDES, overrideItemRoutes } from '../../overrideRoutes'

// Clearing a per-plan override for recurring savings. Registered from the same family as
// the collection route beside it, so a family cannot ship without its DELETE the
// way insurance once did (#467, #690).
export const { DELETE } = overrideItemRoutes(RECURRING_SAVING_OVERRIDES)
