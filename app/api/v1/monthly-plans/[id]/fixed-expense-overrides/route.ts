import { FIXED_EXPENSE_OVERRIDES, overrideCollectionRoutes } from '../overrideRoutes'

// Per-plan overrides for fixed expenses. Everything about the shape of this endpoint —
// auth, plan ownership, ownership of the referenced record, the upsert and the
// error mapping — lives in overrideRoutes; what is specific to fixed expenses is
// declared in FIXED_EXPENSE_OVERRIDES (#690).
export const { GET, POST } = overrideCollectionRoutes(FIXED_EXPENSE_OVERRIDES)
