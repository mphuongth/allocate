// Stable Next.js ambient types for the deterministic typecheck (#468).
//
// This mirrors the committed `next-env.d.ts` MINUS its one build-dependent line:
//   import "./.next/dev/types/routes.d.ts"
// That import pulls Next's *generated* typed-route declarations into the program.
// `exclude` cannot keep them out — exclude only blocks glob discovery, not files
// reached through an import/reference — so a plain `tsc` would depend on whatever
// `.next` a prior build left behind (non-deterministic). tsconfig.typecheck.json
// swaps `next-env.d.ts` out for this shim so the typecheck sees only the stable
// `next` ambient types; typed-route checking still runs inside `next build`.
/// <reference types="next" />
/// <reference types="next/image-types/global" />
