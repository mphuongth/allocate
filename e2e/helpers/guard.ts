// Safety guard: keep the E2E suite from ever running against the production
// Supabase project.
//
// The suite signs up throwaway users and creates/deletes funds, goals,
// transactions, plans, etc. in tight loops (see global.setup.ts and api.ts).
// Pointed at production this churns real data and generates a large amount of
// write I/O (WAL + autovacuum) — the root cause of a Disk IO budget alert.
//
// This module is intentionally dependency-free so it can be imported by both
// the Playwright setup/helpers and the Vitest unit test (which lives outside
// the e2e/ tree that Vitest otherwise excludes).

/**
 * Production Supabase project ref(s) the E2E suite must never target.
 * A Supabase project ref is the subdomain of its API URL, e.g.
 * `https://<ref>.supabase.co`. These are not secrets (they appear in public
 * API URLs); listing them here lets the guard fail fast with no extra config.
 */
export const PRODUCTION_PROJECT_REFS = ['nradevujubvvjgcfqlby']

/** Extract the project ref (API subdomain) from a Supabase URL, or null. */
export function extractProjectRef(url: string | undefined | null): string | null {
  if (!url) return null
  const m = url.match(/^https?:\/\/([^.]+)\.supabase\./i)
  return m ? m[1] : null
}

/** True when `url` points at a known production project. */
export function isProductionTarget(
  url: string | undefined | null,
  blockedRefs: string[] = PRODUCTION_PROJECT_REFS,
): boolean {
  const ref = extractProjectRef(url)
  return ref != null && blockedRefs.includes(ref)
}

/**
 * Throw if `url` points at production, unless explicitly overridden.
 * Pass `{ allow: true }` (wired to `E2E_ALLOW_PROD=1`) to bypass in an
 * emergency.
 */
export function assertSafeTestTarget(
  url: string | undefined | null,
  opts: { allow?: boolean; blockedRefs?: string[] } = {},
): void {
  if (opts.allow) return
  if (isProductionTarget(url, opts.blockedRefs)) {
    throw new Error(
      `Refusing to run E2E tests against production Supabase project ` +
        `"${extractProjectRef(url)}". E2E seeds and deletes data in a loop and ` +
        `must use a dedicated test project. Point E2E_SUPABASE_URL at a non-prod ` +
        `project, or set E2E_ALLOW_PROD=1 to override.`,
    )
  }
}
