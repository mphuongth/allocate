// Vietnamese-style number formatting for input fields.
//
// Convention (VN): thousands are grouped with '.', the decimal separator is ','.
// e.g. twenty-five thousand two hundred nineteen and a half → "25.219,5".
//
// The *canonical* value we keep in React state (and hand to Number()/the API)
// always uses '.' as the decimal separator and carries NO grouping — so every
// downstream `Number(x)` / `parseFloat(x)` keeps working unchanged. These
// helpers only bridge that canonical form to/from the VN display string.

/** Group a pure-digit string with '.' every three digits: "20000" → "20.000". */
function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** Canonical integer digits → VN display. "2000000" → "2.000.000". */
export function formatIntVN(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits === '') return ''
  return groupDigits(digits)
}

/** VN display (or legacy US) → canonical integer digits. "20.000" → "20000". */
export function parseIntVN(display: string): string {
  return display.replace(/\D/g, '')
}

/** Canonical decimal ("25219.5") → VN display ("25.219,5"). */
export function formatDecimalVN(raw: string): string {
  if (raw === '') return ''
  const dot = raw.indexOf('.')
  if (dot === -1) return groupDigits(raw.replace(/\D/g, ''))
  const intDigits = raw.slice(0, dot).replace(/\D/g, '')
  const decDigits = raw.slice(dot + 1).replace(/\D/g, '')
  return `${groupDigits(intDigits)},${decDigits}`
}

/**
 * VN display → canonical decimal. The comma is the one and only decimal
 * separator; every '.' is grouping and is dropped. A stray currency symbol or
 * spaces are ignored. Multiple commas collapse onto the first one.
 * "25.219,5" → "25219.5", raw keypad "20000,5" → "20000.5".
 */
export function parseDecimalVN(display: string): string {
  const cleaned = display.replace(/[^0-9,]/g, '') // drop grouping dots, ₫, spaces
  const comma = cleaned.indexOf(',')
  if (comma === -1) return cleaned
  const intPart = cleaned.slice(0, comma)
  const decPart = cleaned.slice(comma + 1).replace(/,/g, '')
  if (intPart === '' && decPart === '') return '' // a lone separator isn't a number
  return `${intPart}.${decPart}`
}
