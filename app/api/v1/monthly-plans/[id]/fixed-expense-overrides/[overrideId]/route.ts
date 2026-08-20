import { FIXED_EXPENSE_OVERRIDES, overrideItemRoutes } from '../../overrideRoutes'

// Clearing a per-plan override for fixed expenses. Registered from the same family as
// the collection route beside it, so a family cannot ship without its DELETE the
// way insurance once did (#467, #690).
export const { DELETE } = overrideItemRoutes(FIXED_EXPENSE_OVERRIDES)
