export function parseVietnameseNumber(raw: string): number {
  const cleaned = raw.replace(/[^\d.,]/g, '').trim()
  if (/,\d{2}$/.test(cleaned)) {
    return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'))
  }
  return parseFloat(cleaned.replace(/,/g, ''))
}

export async function scrapeGoldPrice(): Promise<number> {
  const html = await fetch('https://giavang.doji.vn', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'vi-VN,vi;q=0.9',
    },
  }).then((r) => r.text())

  const match = html.match(/NHẪN TRÒN[\s\S]{0,300}?<td[^>]*>([\d.,]+)<\/td>/)
  if (!match) throw new Error('Doji: NHẪN TRÒN price row not found')

  const raw = parseVietnameseNumber(match[1])
  if (isNaN(raw) || raw <= 0) throw new Error('Doji: invalid price value')

  return raw * 1000
}
