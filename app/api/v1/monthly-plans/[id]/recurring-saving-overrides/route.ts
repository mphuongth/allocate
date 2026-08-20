import { RECURRING_SAVING_OVERRIDES, overrideCollectionRoutes } from '../overrideRoutes'

// Per-plan overrides for recurring savings. Everything about the shape of this endpoint —
// auth, plan ownership, ownership of the referenced record, the upsert and the
// error mapping — lives in overrideRoutes; what is specific to recurring savings is
// declared in RECURRING_SAVING_OVERRIDES (#690).
export const { GET, POST } = overrideCollectionRoutes(RECURRING_SAVING_OVERRIDES)
