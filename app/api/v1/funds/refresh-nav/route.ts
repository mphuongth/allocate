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

// Fetch HTML with Node.js https module (supports rejectUnauthorized: false)
function fetchWithNodeHttps(url: string, options: { rejectUnauthorized?: boolean } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const agent = new https.Agent({ rejectUnauthorized: options.rejectUnauthorized ?? true })
    https.get(url, { agent }, (res) => {
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
  const html = await fetch(url).then(r => r.text())
  // Look for NAV/unit in table rows — grab first numeric value in a row that looks like a date row
  // The table has columns: Date | NAV/unit | ...
  // Match pattern: a row with date then the NAV value
  const rowMatch = html.match(/<tr[^>]*>[\s\S]*?<td[^>]*>[\s\S]*?\d{1,2}\/\d{1,2}\/\d{4}[\s\S]*?<\/td>[\s\S]*?<td[^>]*>([\d,. ]+)<\/td>/i)
  if (rowMatch) {
    return parseVietnameseNumber(rowMatch[1])
  }
  // Fallback: find any NAV-like value (5-6 digit number with decimals)
  const navMatch = html.match(/(\d{2,3}[,.]?\d{3}[,.]?\d{2,3}(?:[,.]\d{2})?)/)
  if (!navMatch) throw new Error('SSIAM: NAV not found')
  return parseVietnameseNumber(navMatch[1])
}

async function scrapeDragonCapital(url: string): Promise<number> {
  // Dragon Capital has SSL cert issues — fetch with rejectUnauthorized: false
  const html = await fetchWithNodeHttps(url, { rejectUnauthorized: false })
  // Look for NAV value in HTML — typically shown as "XX,XXX.XX" or "XX.XXX,XX"
  const match = html.match(/NAV[^<]*?(?:VND)?[^<]*?([\d]{2,3}[,.][\d]{3}(?:[,.][\d]{2,3})?)/i)
  if (!match) {
    // Broader fallback: find large numbers that look like fund NAV (10,000+)
    const fallback = html.match(/(\d{2,3}[,.]\d{3}(?:[,.]\d{2,4})?)/g)
    if (!fallback) throw new Error('Dragon Capital: NAV not found')
    // Take the first plausible value
    return parseVietnameseNumber(fallback[0])
  }
  return parseVietnameseNumber(match[1])
}

async function scrapeVinaCapital(url: string): Promise<number> {
  const html = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Referer': 'https://vinacapital.com/',
    },
  }).then(r => {
    if (!r.ok) throw new Error(`VinaCapital: HTTP ${r.status}`)
    return r.text()
  })

  // Look for NAV value — VinaCapital typically shows it as "XX,XXX" or "XX.XXX,XX"
  const match = html.match(/NAV[^<]{0,100}?([\d]{2,3}[,.]\d{3}(?:[,.]\d{2,4})?)/i)
  if (!match) {
    const fallback = html.match(/([\d]{2,3}[,.]\d{3}(?:[,.]\d{2,4})?)/g)
    if (!fallback) throw new Error('VinaCapital: NAV not found')
    return parseVietnameseNumber(fallback[0])
  }
  return parseVietnameseNumber(match[1])
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
