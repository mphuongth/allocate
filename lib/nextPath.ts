/**
 * Where to send someone after they sign in — or null when the candidate is not
 * a path within this app.
 *
 * `//host` and `/\host` are both protocol-relative URLs to a browser, so a bare
 * "starts with /" is not enough: `?next` arrives in a link and is therefore
 * attacker-controllable.
 *
 * Its own module rather than a sibling of the session-expiry store: the
 * middleware needs it, and middleware runs on the edge runtime where pulling in
 * React (which that store does, for useSyncExternalStore) has no business being.
 */
export function safeNextPath(candidate: string | null): string | null {
  if (!candidate || !candidate.startsWith('/')) return null
  if (candidate.startsWith('//') || candidate.startsWith('/\\')) return null
  return candidate
}
