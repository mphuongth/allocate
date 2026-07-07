import { describe, it, expect } from 'vitest'
import {
  formatIntVN,
  parseIntVN,
  formatDecimalVN,
  parseDecimalVN,
} from '../numberFormat'

// Canonical (state) strings always use '.' as the decimal separator and carry
// NO grouping — so Number()/API code stays untouched. The VN display layer
// groups thousands with '.' and marks the decimal with ','.

describe('formatIntVN', () => {
  it('groups thousands with dots', () => {
    expect(formatIntVN('20000')).toBe('20.000')
    expect(formatIntVN('2000000')).toBe('2.000.000')
    expect(formatIntVN('5000000')).toBe('5.000.000')
  })
  it('leaves short numbers untouched', () => {
    expect(formatIntVN('0')).toBe('0')
    expect(formatIntVN('999')).toBe('999')
  })
  it('returns empty string for empty input', () => {
    expect(formatIntVN('')).toBe('')
  })
})

describe('parseIntVN', () => {
  it('strips grouping dots back to canonical digits', () => {
    expect(parseIntVN('20.000')).toBe('20000')
    expect(parseIntVN('2.000.000')).toBe('2000000')
  })
  it('drops any stray non-digits', () => {
    expect(parseIntVN('₫ 20.000')).toBe('20000')
    expect(parseIntVN('20,000')).toBe('20000') // legacy US comma tolerated
  })
  it('returns empty string for empty input', () => {
    expect(parseIntVN('')).toBe('')
  })
})

describe('formatDecimalVN', () => {
  it('groups the integer part and marks the decimal with a comma', () => {
    expect(formatDecimalVN('25219.5')).toBe('25.219,5')
    expect(formatDecimalVN('25219.05')).toBe('25.219,05')
    expect(formatDecimalVN('1234567.89')).toBe('1.234.567,89')
  })
  it('formats whole numbers with grouping and no decimal marker', () => {
    expect(formatDecimalVN('20000')).toBe('20.000')
  })
  it('preserves a trailing decimal separator while typing', () => {
    expect(formatDecimalVN('20000.')).toBe('20.000,')
  })
  it('renders a leading decimal with no integer part', () => {
    expect(formatDecimalVN('.5')).toBe(',5')
  })
  it('returns empty string for empty input', () => {
    expect(formatDecimalVN('')).toBe('')
  })
})

describe('parseDecimalVN', () => {
  it('treats comma as the decimal separator and dots as grouping', () => {
    expect(parseDecimalVN('25.219,5')).toBe('25219.5')
    expect(parseDecimalVN('20.000')).toBe('20000')
  })
  it('accepts the raw keypad comma (no grouping typed yet)', () => {
    expect(parseDecimalVN('20000,5')).toBe('20000.5')
  })
  it('always treats dots as grouping (VN convention), never as a decimal', () => {
    // committed rule: only the comma is a decimal separator; dots are grouping
    expect(parseDecimalVN('20.5')).toBe('205')
  })
  it('collapses multiple commas to a single decimal point', () => {
    expect(parseDecimalVN('20,5,6')).toBe('20.56')
  })
  it('strips the currency symbol and spaces', () => {
    expect(parseDecimalVN('₫ 25.219,50')).toBe('25219.50')
  })
  it('returns empty string for empty input', () => {
    expect(parseDecimalVN('')).toBe('')
  })
  it('treats a lone separator as empty, not a number', () => {
    expect(parseDecimalVN(',')).toBe('')
    expect(parseDecimalVN('.')).toBe('')
  })
  it('keeps a leading decimal with no integer part', () => {
    expect(parseDecimalVN(',5')).toBe('.5')
  })
})
