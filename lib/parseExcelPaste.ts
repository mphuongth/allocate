export interface ParsedRow {
  investment_date: string
  amount_vnd: number
  unit_price: number
  units: number
  error?: string
}

export function parseExcelPaste(raw: string): ParsedRow[] {
  return raw
    .trim()
    .split('\n')
    .map((line) => line.split('\t'))
    .filter((cols) => cols.length >= 5)
    .map((cols) => {
      const raw0 = cols[0].trim()
      let investment_date = ''
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw0)) {
        investment_date = raw0
      } else {
        const parts = raw0.split('/')
        if (parts.length === 3) {
          const [d, m, y] = parts
          investment_date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
        } else if (parts.length === 2) {
          const [m, y] = parts
          investment_date = `${y}-${m.padStart(2, '0')}-01`
        }
      }
      const parseNum = (s: string) => parseFloat(s.replace(/,/g, '').trim())
      const amount_vnd = parseNum(cols[1])
      const unit_price = parseNum(cols[3])
      const units = parseNum(cols[4])
      const error =
        !investment_date || isNaN(amount_vnd) || isNaN(unit_price) || isNaN(units)
          ? 'Cannot parse row'
          : undefined
      return { investment_date, amount_vnd, unit_price, units, error }
    })
}
