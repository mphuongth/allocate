import type { JWK } from '@supabase/supabase-js'

/**
 * Who the request belongs to, read from the session's signed access token.
 *
 * `supabase.auth.getUser()` answers the same question by asking Supabase Auth
 * over the network — on every page load, up to three times before any HTML went
 * out. This checks the token's ES256 signature against the project's public
 * keys instead, so a page no longer waits on the Auth service to be awake.
 *
 * What that trades away: a token stays good until it expires (an hour at most)
 * even if its session was revoked elsewhere in the meantime. Data access is
 * unaffected by the difference — PostgREST and RLS have always trusted the same
 * signature, never a call to Auth.
 */
export interface SessionUser {
  id: string
  email: string
  /** `display_name`, or the `full_name` an OAuth sign-up carries. */
  displayName?: string
}

type Jwks = { keys: JWK[] }

/** The slice of the Supabase client this needs — also what the tests stand in for. */
interface ClaimsClient {
  auth: {
    getClaims(
      jwt?: string,
      options?: { jwks?: Jwks },
    ): Promise<{ data: { claims: Record<string, unknown> } | null; error: unknown }>
  }
}

// The Supabase client is built per request and keeps its key cache on itself,
// so left to its own devices it would fetch the signing keys on every request.
// They are public and change only on a key rotation: hold them per function
// instance. A token signed by a key newer than this copy still verifies — the
// client fetches the key itself when the `kid` isn't among the ones supplied.
const SIGNING_KEYS_TTL_MS = 10 * 60 * 1000

let signingKeys: { url: string; jwks: Jwks; fetchedAt: number } | null = null
let signingKeysInFlight: Promise<Jwks | undefined> | null = null

/** Test seam: forget the cached keys. */
export function resetSigningKeyCache() {
  signingKeys = null
  signingKeysInFlight = null
}

async function loadSigningKeys(supabaseUrl: string | undefined): Promise<Jwks | undefined> {
  if (!supabaseUrl) return undefined
  if (signingKeys && signingKeys.url === supabaseUrl && Date.now() - signingKeys.fetchedAt < SIGNING_KEYS_TTL_MS) {
    return signingKeys.jwks
  }
  signingKeysInFlight ??= (async () => {
    try {
      const res = await fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)
      if (!res.ok) return undefined
      const jwks = (await res.json()) as Jwks
      if (!Array.isArray(jwks?.keys) || jwks.keys.length === 0) return undefined
      signingKeys = { url: supabaseUrl, jwks, fetchedAt: Date.now() }
      return jwks
    } catch {
      // Not remembered: the next request tries again, and this one falls back
      // to the client finding the key for itself.
      return undefined
    } finally {
      signingKeysInFlight = null
    }
  })()
  return signingKeysInFlight
}

export async function getSessionUser(
  supabase: ClaimsClient,
  supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
): Promise<SessionUser | null> {
  try {
    const jwks = await loadSigningKeys(supabaseUrl)
    const { data, error } = await supabase.auth.getClaims(undefined, jwks ? { jwks } : undefined)
    if (error || !data) return null

    const { sub, email, user_metadata: metadata } = data.claims as {
      sub?: unknown
      email?: unknown
      user_metadata?: { display_name?: unknown; full_name?: unknown } | null
    }
    if (typeof sub !== 'string' || sub === '') return null

    const name = metadata?.display_name || metadata?.full_name
    return {
      id: sub,
      email: typeof email === 'string' ? email : '',
      ...(typeof name === 'string' && name ? { displayName: name } : {}),
    }
  } catch {
    // An unreadable or unverifiable token is "not signed in", never a 500.
    return null
  }
}
