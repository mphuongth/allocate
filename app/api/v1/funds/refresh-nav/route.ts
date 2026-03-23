import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import https from 'https'

// Parse Vietnamese number format to float
// Handles "14,739.10" (comma thousands, dot decimal) and "44.378,54" (dot thousands, comma decimal)
function parseVietnameseNumber(raw: string): number {
  const cleaned = raw.replace(/[^\d.,]/g, '').trim()
  // If it ends with comma+2digits, it's European format (dot=thousands, comma=decimal)
  if (/,\d{2}$/.test(cleaned)) {
    return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'))
  }
  // Otherwise standard format (comma=thousands, dot=decimal)
  return parseFloat(cleaned.replace(/,/g, ''))
}

// Fetch with Node.js https module (supports rejectUnauthorized: false and custom headers)
function fetchWithNodeHttps(url: string, options: { rejectUnauthorized?: boolean; headers?: Record<string, string> } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const agent = new https.Agent({ rejectUnauthorized: options.rejectUnauthorized ?? true })
    const parsedUrl = new URL(url)
    const reqOptions = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: options.headers,
      agent,
    }
    https.get(reqOptions, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => resolve(data))
    }).on('error', reject)
  })
}

async function scrapeVCBF(url: string): Promise<number> {
  const html = await fetch(url).then(r => r.text())
  const match = html.match(/var dataJson\s*=\s*JSON\.parse\('(.+?)'\)/)
  if (!match) throw new Error('VCBF: dataJson not found')
  const data = JSON.parse(match[1])

  // Determine which fund data key to use based on URL path
  let price: string | undefined
  if (url.includes('trai-phieu')) {
    price = data?.fif_data?.price
  } else if (url.includes('co-phieu-tang-truong')) {
    price = data?.mgf_data?.price
  } else if (url.includes('can-bang')) {
    price = data?.tbf_data?.price
  } else {
    // Try all known keys
    price = data?.fif_data?.price ?? data?.mgf_data?.price ?? data?.tbf_data?.price
  }

  if (!price) throw new Error('VCBF: price not found in dataJson')
  return parseVietnameseNumber(String(price))
}

async function scrapeSSIAM(url: string): Promise<number> {
  const html = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  }).then(r => r.text())

  // Primary: find NAV/CCQ label in the page, then extract the next number near it.
  // The card section contains "NAV/CCQ" followed by the value like "44.378,54 VND"
  const navLabelMatch = html.match(/NAV\/CCQ[\s\S]{0,300}?([\d]{1,3}[.,][\d]{3}[.,][\d]{2})/)
  if (navLabelMatch) {
    return parseVietnameseNumber(navLabelMatch[1])
  }

  // Fallback: table columns are [fund-name, NAV, date, ...] — NAV comes BEFORE the date
  // Match: <td>NAV-value</td> immediately before a <td>with a date</td>
  const tableMatch = html.match(/<td[^>]*>([\d.,]+)<\/td>\s*<td[^>]*>\d{1,2}\/\d{1,2}\/\d{4}<\/td>/i)
  if (tableMatch) {
    return parseVietnameseNumber(tableMatch[1])
  }

  throw new Error('SSIAM: NAV not found')
}

// Dragon Capital uses a Salesforce LWC SPA.
// The URL slug (e.g. "dcde") is the fundReportCode__c, but the Apex API requires fundCode__c (e.g. "VF4").
// We discover the mapping by querying VF1–VF15 in parallel and matching fundReportCode__c.
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
      cacheable: 'true',
      classname,
      isContinuation: 'false',
      method: 'getFundRelatedDataByDateRange',
      namespace: '',
      params,
      language: 'vi',
      asGuest: 'true',
      htmlEncode: 'false',
    })
    const apiUrl = `https://www.dragoncapital.com.vn/individual/vi/webruntime/api/apex/execute?${qs}`
    try {
      const text = await fetchWithNodeHttps(apiUrl, {
        rejectUnauthorized: false,
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
    } catch { /* skip failed requests */ }
    return null
  }

  // Query VF1–VF15 in parallel — find the one whose fundReportCode__c matches the URL slug
  const results = await Promise.all(Array.from({ length: 15 }, (_, i) => queryFundCode(`VF${i + 1}`)))
  const match = results.find(r => r && r.reportCode === urlReportCode)
  if (!match) throw new Error(`Dragon Capital: no fund with reportCode "${urlReportCode}" found`)

  return match.navPerShare
}

async function scrapeVinaCapital(url: string): Promise<number> {
  // vinacapital.com uses WordPress. The wp-admin/admin-ajax.php endpoint with
  // action=getchartfundnav is a backend AJAX route that may not be behind the Cloudflare
  // JS challenge protecting the frontend. Fund name is extracted from the URL slug.
  const pathSegments = new URL(url).pathname.split('/').filter(Boolean)
  const fundName = pathSegments[pathSegments.length - 1].toUpperCase()
  if (!fundName) throw new Error('VinaCapital: could not extract fund name from URL')

  const body = new URLSearchParams()
  body.append('action', 'getchartfundnav')
  body.append('fundname', fundName)

  const res = await fetch('https://vinacapital.com/wp-admin/admin-ajax.php', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': url,
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.6,en;q=0.5',
    },
    body: body.toString(),
  })

  const html = await res.text()
  if (!html || !html.includes('rpfundnavcontent')) {
    throw new Error(`VinaCapital: AJAX endpoint returned no fund data for "${fundName}". Site may be protected by Cloudflare JS challenge — update NAV manually.`)
  }

  const navMatch = html.match(/rpfundnavcontent f4">([\s\S]*?)<\/div>/)
  if (!navMatch) throw new Error('VinaCapital: could not parse NAV from AJAX response')

  return parseVietnameseNumber(navMatch[1].trim())
}

async function scrapeNav(url: string): Promise<{ nav: number } | { error: string }> {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    let nav: number

    if (hostname.includes('vcbf.com')) {
      nav = await scrapeVCBF(url)
    } else if (hostname.includes('ssiam.com.vn')) {
      nav = await scrapeSSIAM(url)
    } else if (hostname.includes('dragoncapital.com.vn')) {
      nav = await scrapeDragonCapital(url)
    } else if (hostname.includes('vinacapital.com')) {
      nav = await scrapeVinaCapital(url)
    } else {
      return { error: `Unsupported domain: ${hostname}` }
    }

    if (isNaN(nav) || nav <= 0) {
      return { error: 'Parsed NAV is invalid' }
    }

    return { nav }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown scraping error' }
  }
}

export async function POST() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Fetch all funds that have a nav_source_url
  const { data: funds, error: fetchError } = await supabase
    .from('funds')
    .select('id, name, code, nav_source_url')
    .eq('user_id', user.id)
    .not('nav_source_url', 'is', null)

  if (fetchError) {
    return NextResponse.json({ error: 'Failed to fetch funds' }, { status: 500 })
  }

  if (!funds || funds.length === 0) {
    return NextResponse.json({ results: [] })
  }

  // Scrape NAV for each fund in parallel
  const scrapeResults = await Promise.all(
    funds.map(async (fund) => {
      const result = await scrapeNav(fund.nav_source_url!)
      return { fund, result }
    })
  )

  // Batch update successful ones
  const results = []
  for (const { fund, result } of scrapeResults) {
    if ('nav' in result) {
      const { data: updated, error: updateError } = await supabase
        .from('funds')
        .update({ nav: result.nav, updated_at: new Date().toISOString() })
        .eq('id', fund.id)
        .eq('user_id', user.id)
        .select('id, name, code, nav, updated_at')
        .single()

      if (updateError || !updated) {
        results.push({ id: fund.id, name: fund.name, code: fund.code, error: 'Failed to update in database' })
      } else {
        results.push({ id: updated.id, name: updated.name, code: updated.code, nav: updated.nav, updatedAt: updated.updated_at })
      }
    } else {
      results.push({ id: fund.id, name: fund.name, code: fund.code, error: result.error })
    }
  }

  return NextResponse.json({ results })
}
