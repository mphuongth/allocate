import { describe, it, expect, vi, afterEach } from 'vitest'
import { isAllowedNavHost, validateNavSourceUrl, scrapeFundNav, normalizeNavUrl } from '../scrape-fund-nav'
import { ValidationError } from '../validation'

// SSRF guard: nav_source_url is user-supplied and later fetched server-side (by
// the refresh-nav route + the daily cron). The host gate must be an EXACT match
// on the vendor domains — the old `hostname.includes('vcbf.com')` substring gate
// let attacker-controlled hosts like evilvcbf.com / vcbf.com.attacker.com through.

describe('isAllowedNavHost — exact vendor-host match', () => {
  it('accepts the exact vendor domains and their subdomains', () => {
    for (const h of ['vcbf.com', 'www.vcbf.com', 'ssiam.com.vn', 'www.ssiam.com.vn',
                     'dragoncapital.com.vn', 'www.dragoncapital.com.vn', 'vinacapital.com', 'www.vinacapital.com']) {
      expect(isAllowedNavHost(h)).toBe(true)
    }
  })

  it('rejects substring-bypass hosts the old gate would have allowed', () => {
    for (const h of ['evilvcbf.com', 'vcbf.com.attacker.com', 'ssiam.com.vn.evil.com',
                     'notvcbf.com', 'vcbf.com.evil', 'dragoncapital.com.vn.attacker.net']) {
      expect(isAllowedNavHost(h)).toBe(false)
    }
  })

  it('rejects internal / unrelated hosts', () => {
    for (const h of ['127.0.0.1', 'localhost', '169.254.169.254', 'metadata.google.internal', 'example.com']) {
      expect(isAllowedNavHost(h)).toBe(false)
    }
  })
})

describe('validateNavSourceUrl — write-time SSRF validation', () => {
  it('returns null for empty / absent input (nav_source_url is optional)', () => {
    expect(validateNavSourceUrl(null)).toBeNull()
    expect(validateNavSourceUrl(undefined)).toBeNull()
    expect(validateNavSourceUrl('')).toBeNull()
    expect(validateNavSourceUrl('   ')).toBeNull()
  })

  it('accepts a valid https vendor URL and returns it', () => {
    const url = 'https://www.vcbf.com/quy-mo/quy-trai-phieu'
    expect(validateNavSourceUrl(url)).toBe(url)
  })

  it('rejects a non-https scheme', () => {
    expect(() => validateNavSourceUrl('http://www.vcbf.com/x')).toThrow(ValidationError)
  })

  it('rejects the substring-bypass hosts (SSRF)', () => {
    expect(() => validateNavSourceUrl('https://evilvcbf.com/x')).toThrow(ValidationError)
    expect(() => validateNavSourceUrl('https://vcbf.com.attacker.com/x')).toThrow(ValidationError)
  })

  it('rejects the userinfo trick where the real host is attacker-controlled', () => {
    // new URL('https://vcbf.com@evil.com').hostname === 'evil.com'
    expect(() => validateNavSourceUrl('https://vcbf.com@evil.com/x')).toThrow(ValidationError)
  })

  it('rejects internal targets and malformed URLs', () => {
    expect(() => validateNavSourceUrl('https://127.0.0.1/x')).toThrow(ValidationError)
    expect(() => validateNavSourceUrl('https://169.254.169.254/latest/meta-data/')).toThrow(ValidationError)
    expect(() => validateNavSourceUrl('not a url')).toThrow(ValidationError)
    expect(() => validateNavSourceUrl(42)).toThrow(ValidationError)
  })
})

describe('scrapeFundNav — rejects disallowed hosts before any fetch', () => {
  it('returns an Unsupported-domain error for a substring-bypass host (no network hit)', async () => {
    const res = await scrapeFundNav('https://evilvcbf.com/x')
    expect(res).toEqual({ error: expect.stringMatching(/unsupported domain/i) })
  })
})

describe('normalizeNavUrl — de-dup key', () => {
  it('lowercases the host but preserves path case (Dragon/VinaCapital fund codes)', () => {
    expect(normalizeNavUrl('https://WWW.DragonCapital.com.vn/individual/vi/x/VEOF'))
      .toBe('https://www.dragoncapital.com.vn/individual/vi/x/VEOF')
  })

  it('collapses trailing slash and fragment so trivially-different URLs share one scrape', () => {
    const a = normalizeNavUrl('https://vcbf.com/quy/vcbf-fif/')
    const b = normalizeNavUrl('https://vcbf.com/quy/vcbf-fif#nav')
    expect(a).toBe(b)
  })

  it('returns the trimmed input unchanged when it is not a valid URL', () => {
    expect(normalizeNavUrl('  not a url  ')).toBe('not a url')
  })
})

describe('scrapeFundNav — bounded provider fetch (timeout + size cap)', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('turns an oversized response body into a per-fund error, not a hang', async () => {
    // 3 MB body exceeds the 2 MB cap → boundedFetchText throws → { error }.
    const huge = 'x'.repeat(3 * 1024 * 1024)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(huge)))
    const res = await scrapeFundNav('https://vcbf.com/quy/vcbf-fif')
    expect(res).toHaveProperty('error')
  })

  it('turns a fetch/timeout rejection into a per-fund error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('The operation was aborted due to timeout') }))
    const res = await scrapeFundNav('https://vcbf.com/quy/vcbf-fif')
    expect(res).toEqual({ error: expect.stringMatching(/timeout|abort/i) })
  })
})
