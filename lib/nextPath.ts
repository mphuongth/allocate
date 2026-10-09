// Never a real host: a candidate that resolves anywhere else left the app.
const BASE = 'https://next-path.invalid'

/**
 * Where to send someone after they sign in — or null when the candidate is not
 * a path within this app.
 *
 * `?next` arrives in a link and is therefore attacker-controllable. Checking
 * its prefix is not enough: `//host` and `/\host` are protocol-relative, and
 * the URL parser strips tab, LF and CR anywhere, so `/\t/host` becomes
 * `//host` too (#759). So resolve it the way the browser will and keep it only
 * if it stays on our origin — returning the resolved path, not the raw input.
 *
 * Its own module rather than a sibling of the session-expiry store: the
 * middleware needs it, and middleware runs on the edge runtime where pulling in
 * React (which that store does, for useSyncExternalStore) has no business being.
 */
export function safeNextPath(candidate: string | null): string | null {
  if (!candidate || !candidate.startsWith('/')) return null
  let url: URL
  try {
    url = new URL(candidate, BASE)
  } catch {
    return null
  }
  if (url.origin !== BASE) return null
  return url.pathname + url.search + url.hash
}
