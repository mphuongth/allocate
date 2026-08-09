import { ValidationError } from './validation'

// `nav_source_url` records which provider a fund is priced from, and doubles as
// the per-fund opt-in for automatic pricing. It is no longer fetched — NAVs come
// from the Fmarket feed keyed by fund code (lib/fmarket-nav.ts), which replaced
// four per-provider scrapers that had each rotted in a different way.
//
// The host gate stays regardless. The value is user-supplied and stored, so an
// unvalidated field is a URL waiting to be fetched by whatever reads it next;
// keeping the allowlist means that day can't arrive as an SSRF.
const ALLOWED_NAV_HOSTS = ['vcbf.com', 'ssiam.com.vn', 'dragoncapital.com.vn', 'vinacapital.com'] as const

// Exact host match (or a subdomain of an allowed host). Deliberately NOT a
// substring check: `'evilvcbf.com'.includes('vcbf.com')` is true, which let an
// attacker point an owned domain (with a private-IP DNS record) at the scraper.
export function isAllowedNavHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return ALLOWED_NAV_HOSTS.some((d) => h === d || h.endsWith('.' + d))
}

// Validate a user-supplied fund NAV source URL before storing it. Requires an
// absolute https URL whose host is an allowed fund provider; empty → null.
// Throws ValidationError (the write routes map that to HTTP 400).
export function validateNavSourceUrl(raw: unknown): string | null {
  if (raw == null) return null
  if (typeof raw !== 'string') throw new ValidationError('nav_source_url must be a string')
  const trimmed = raw.trim()
  if (trimmed === '') return null
  let u: URL
  try {
    u = new URL(trimmed)
  } catch {
    throw new ValidationError('nav_source_url must be a valid URL')
  }
  if (u.protocol !== 'https:') throw new ValidationError('nav_source_url must use https')
  if (!isAllowedNavHost(u.hostname)) {
    throw new ValidationError('nav_source_url must point to a supported fund provider')
  }
  return trimmed
}
