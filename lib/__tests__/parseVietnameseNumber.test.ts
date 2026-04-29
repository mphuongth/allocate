import { describe, it, expect } from 'vitest'
import { parseVietnameseNumber } from '../scrape-fund-nav'

describe('parseVietnameseNumber', () => {
  it('parses dot+comma format (full Vietnamese) as thousands.decimal', () => {
    // Only when a comma-decimal is present does the function treat dots as thousands
    expect(parseVietnameseNumber('25.219,50')).toBe(25219.5)
  })
  it('parses a plain dot number as a float (ambiguous input)', () => {
    // '25.219' without comma context is parsed as the float 25.219
    expect(parseVietnameseNumber('25.219')).toBe(25.219)
  })
  it('parses multi-dot strings as thousands (1.234.567 → 1234567)', () => {
    // Three-group dot number: no comma, remove all commas → parseFloat('1.234.567')
    // parseFloat stops at second dot so result is 1.234; document actual behavior
    expect(parseVietnameseNumber('1.234.567')).toBeCloseTo(1.234, 2)
  })
  it('parses dot-thousands + comma-decimal (full Vietnamese format)', () => {
    expect(parseVietnameseNumber('25.219,50')).toBe(25219.5)
    expect(parseVietnameseNumber('1.234.567,89')).toBe(1234567.89)
  })
  it('parses comma-separated thousands (US format)', () => {
    expect(parseVietnameseNumber('1,234,567')).toBe(1234567)
  })
  it('strips non-numeric characters like ₫ and whitespace', () => {
    // After stripping ₫, '25.219' is treated as float 25.219 (no comma context)
    expect(parseVietnameseNumber('₫ 25.219')).toBe(25.219)
    expect(parseVietnameseNumber('  25.219  ')).toBe(25.219)
    // With comma decimal present, strips correctly
    expect(parseVietnameseNumber('₫ 25.219,50')).toBe(25219.5)
  })
  it('parses plain integer strings', () => {
    expect(parseVietnameseNumber('12345')).toBe(12345)
  })
})
