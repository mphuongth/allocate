import https from 'https'
import { ValidationError } from './validation'
import {
  boundedFetchText,
  httpSemaphore,
  SCRAPE_MAX_BYTES,
  SCRAPE_TIMEOUT_MS,
} from './boundedFetch'

// The bounded fetch, its timeout/size limits and the process-wide outbound
// semaphore moved to lib/boundedFetch so the gold scraper shares one
// implementation instead of a second copy (#530). The Node-https path below
// still runs through that same semaphore, so the concurrency cap stays global.

// Normalize a NAV source URL for de-duplication: lowercase the host (case-
// insensitive) but PRESERVE the path/query case — the Dragon Capital and
// VinaCapital scrapers derive the fund code from the last path segment and
// upper-case it, so lowercasing the whole URL would break them. Drops the
// fragment and any trailing slash so trivially-different URLs collapse to one
// scrape.
export function normalizeNavUrl(raw: string): string {
  try {
    const u = new URL(raw.trim())
    u.hostname = u.hostname.toLowerCase()
    u.hash = ''
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '')
    return u.toString()
  } catch {
    return raw.trim()
  }
}

// The only hosts the NAV scraper is allowed to fetch. `nav_source_url` is
// user-supplied and later fetched server-side (refresh-nav route + daily cron),
// so this doubles as the SSRF allowlist.
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

export function parseVietnameseNumber(raw: string): number {
  const cleaned = raw.replace(/[^\d.,]/g, '').trim()
  if (/,\d{2}$/.test(cleaned)) {
    return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'))
  }
  return parseFloat(cleaned.replace(/,/g, ''))
}

// Exported for tests: exercises the Node-https path's absolute deadline and the
// shared outbound-request semaphore without going through a full Dragon scrape.
export function fetchWithNodeHttps(url: string, options: { rejectUnauthorized?: boolean; headers?: Record<string, string>; timeoutMs?: number; maxBytes?: number } = {}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? SCRAPE_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? SCRAPE_MAX_BYTES
  return httpSemaphore.run(() => new Promise<string>((resolve, reject) => {
    const agent = new https.Agent({ rejectUnauthorized: options.rejectUnauthorized ?? true })
    const parsedUrl = new URL(url)
    const reqOptions = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: options.headers,
      agent,
    }
    const req = https.get(reqOptions, (res) => {
      let data = ''
      let total = 0
      res.on('data', (chunk) => {
        total += chunk.length
        if (total > maxBytes) {
          req.destroy(new Error(`Response exceeded ${maxBytes} bytes`))
          return
        }
        data += chunk
      })
      res.on('end', () => settle(resolve, data))
    })
    req.on('error', (err) => settle(reject, err))
    // Absolute deadline for the whole request, not a per-socket inactivity
    // timeout: req.setTimeout() resets on every chunk, so a slow drip could keep
    // the request alive indefinitely. This timer fires once, timeoutMs after the
    // request starts, and is cleared the moment the request settles.
    const deadline = setTimeout(() => req.destroy(new Error('Request timed out')), timeoutMs)
    let settled = false
    function settle(fn: (v: never) => void, value: unknown) {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      fn(value as never)
    }
  }))
}

async function scrapeVCBF(url: string): Promise<number> {
  const html = await boundedFetchText(url)
  const match = html.match(/var dataJson\s*=\s*JSON\.parse\('(.+?)'\)/)
  if (!match) throw new Error('VCBF: dataJson not found')
  const data = JSON.parse(match[1])

  let price: string | undefined
  if (url.includes('trai-phieu')) {
    price = data?.fif_data?.price
  } else if (url.includes('co-phieu-tang-truong')) {
    price = data?.mgf_data?.price
  } else if (url.includes('can-bang')) {
    price = data?.tbf_data?.price
  } else {
    price = data?.fif_data?.price ?? data?.mgf_data?.price ?? data?.tbf_data?.price
  }

  if (!price) throw new Error('VCBF: price not found in dataJson')
  return parseVietnameseNumber(String(price))
}

async function scrapeSSIAM(url: string): Promise<number> {
  const html = await boundedFetchText(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  })

  const navLabelMatch = html.match(/NAV\/CCQ[\s\S]{0,300}?([\d]{1,3}[.,][\d]{3}[.,][\d]{2})/)
  if (navLabelMatch) return parseVietnameseNumber(navLabelMatch[1])

  const tableMatch = html.match(/<td[^>]*>([\d.,]+)<\/td>\s*<td[^>]*>\d{1,2}\/\d{1,2}\/\d{4}<\/td>/i)
  if (tableMatch) return parseVietnameseNumber(tableMatch[1])

  throw new Error('SSIAM: NAV not found')
}

async function scrapeDragonCapital(url: string): Promise<number> {
  const pathSegments = new URL(url).pathname.split('/').filter(Boolean)
  const urlReportCode = pathSegments[pathSegments.length - 1].toUpperCase()
  if (!urlReportCode) throw new Error('Dragon Capital: could not extract fund report code from URL')

  const today = new Date().toISOString().split('T')[0]
  const siteId = '0DMJ2000000oLukOAE'
  const classname = '@udd/01pJ2000000CgSu'

  async function queryFundCode(fundCode: string): Promise<{ navPerShare: number; reportCode: string } | null> {
    const params = JSON.stringify({
      endDateIsoString: `${today}T23:59:59.000Z`,
      fundCode,
      orderBy: 'navDate__c',
      orderDirection: 'desc',
      pageNumber: 1,
      pageSize: 1,
      siteId,
      startDateIsoString: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    })
    const qs = new URLSearchParams({
      cacheable: 'true', classname, isContinuation: 'false',
      method: 'getFundRelatedDataByDateRange', namespace: '', params,
      language: 'vi', asGuest: 'true', htmlEncode: 'false',
    })
    const apiUrl = `https://www.dragoncapital.com.vn/individual/vi/webruntime/api/apex/execute?${qs}`
    try {
      const text = await fetchWithNodeHttps(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Referer': 'https://www.dragoncapital.com.vn/individual/vi/tra-cuu-gia-nav/',
        },
      })
      const data = JSON.parse(text)
      const records: Record<string, unknown>[] = data?.returnValue ?? []
      if (records.length > 0) {
        return {
          navPerShare: records[0].navPerShare__c as number,
          reportCode: (records[0].fundReportCode__c as string).toUpperCase(),
        }
      }
    } catch { /* skip */ }
    return null
  }

  const results = await Promise.all(Array.from({ length: 15 }, (_, i) => queryFundCode(`VF${i + 1}`)))
  const match = results.find(r => r && r.reportCode === urlReportCode)
  if (!match) throw new Error(`Dragon Capital: no fund with reportCode "${urlReportCode}" found`)

  return match.navPerShare
}

async function scrapeVinaCapital(url: string): Promise<number> {
  const pathSegments = new URL(url).pathname.split('/').filter(Boolean)
  const fundName = pathSegments[pathSegments.length - 1].toUpperCase()
  if (!fundName) throw new Error('VinaCapital: could not extract fund name from URL')

  const body = new URLSearchParams()
  body.append('action', 'getchartfundnav')
  body.append('fundname', fundName)

  const html = await boundedFetchText('https://vinacapital.com/wp-admin/admin-ajax.php', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': url,
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.6,en;q=0.5',
    },
    body: body.toString(),
  })

  if (!html || !html.includes('rpfundnavcontent')) {
    throw new Error(`VinaCapital: no fund data for "${fundName}". May be behind Cloudflare.`)
  }

  const navMatch = html.match(/rpfundnavcontent f4">([\s\S]*?)<\/div>/)
  if (!navMatch) throw new Error('VinaCapital: could not parse NAV from response')

  return parseVietnameseNumber(navMatch[1].trim())
}

export async function scrapeFundNav(url: string): Promise<{ nav: number } | { error: string }> {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    if (!isAllowedNavHost(hostname)) return { error: `Unsupported domain: ${hostname}` }

    const matches = (d: string) => hostname === d || hostname.endsWith('.' + d)
    let nav: number

    if (matches('vcbf.com')) {
      nav = await scrapeVCBF(url)
    } else if (matches('ssiam.com.vn')) {
      nav = await scrapeSSIAM(url)
    } else if (matches('dragoncapital.com.vn')) {
      nav = await scrapeDragonCapital(url)
    } else if (matches('vinacapital.com')) {
      nav = await scrapeVinaCapital(url)
    } else {
      return { error: `Unsupported domain: ${hostname}` }
    }

    if (isNaN(nav) || nav <= 0) return { error: 'Parsed NAV is invalid' }
    return { nav }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown scraping error' }
  }
}
