import { INSURANCE_OVERRIDES, overrideCollectionRoutes } from '../overrideRoutes'

// Per-plan overrides for insurance members. Everything about the shape of this endpoint —
// auth, plan ownership, ownership of the referenced record, the upsert and the
// error mapping — lives in overrideRoutes; what is specific to insurance members is
// declared in INSURANCE_OVERRIDES (#690).
export const { GET, POST } = overrideCollectionRoutes(INSURANCE_OVERRIDES)
