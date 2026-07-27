import { boundedFetchText } from './boundedFetch'

function parseVietnameseNumber(raw: string): number {
  const cleaned = raw.replace(/[^\d.,]/g, '').trim()
  if (/,\d{2}$/.test(cleaned)) {
    return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'))
  }
  return parseFloat(cleaned.replace(/,/g, ''))
}

// The DOJI fetch goes through the shared bounded helper (#530): an absolute
// timeout so a slow upstream can't hold a serverless function open, a hard byte
// cap so an oversized body can't be read into memory, and a status check so a
// 404/500 error page never reaches the regex below — which would otherwise
// report "price row not found" and send the reader after a layout change that
// didn't happen.
//
// Failures are deliberately left to propagate: both refresh routes turn a throw
// into a 502, whereas swallowing one would store a junk price.
export async function scrapeGoldPrice(): Promise<number> {
  const html = await boundedFetchText('https://giavang.doji.vn', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'vi-VN,vi;q=0.9',
    },
  })

  const match = html.match(/NHẪN TRÒN[\s\S]{0,300}?<td[^>]*>([\d.,]+)<\/td>/)
  if (!match) throw new Error('Doji: NHẪN TRÒN price row not found')

  const raw = parseVietnameseNumber(match[1])
  if (isNaN(raw) || raw <= 0) throw new Error('Doji: invalid price value')

  return raw * 1000
}
