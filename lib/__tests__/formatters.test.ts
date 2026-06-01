import { describe, it, expect } from 'vitest'
import { fmt, fmtNav, fmtUnits, fmtPct } from '../formatters'

describe('fmt', () => {
  it('formats whole VND amounts with vi-VN thousands separator', () => {
    expect(fmt(1000000)).toBe('₫ 1.000.000')
  })
  it('rounds fractional values', () => {
    expect(fmt(1000.7)).toBe('₫ 1.001')
    expect(fmt(1000.3)).toBe('₫ 1.000')
  })
  it('formats zero', () => {
    expect(fmt(0)).toBe('₫ 0')
  })
  it('formats negative values', () => {
    expect(fmt(-500000)).toBe('₫ -500.000')
  })
  it('formats large values (billions)', () => {
    expect(fmt(1_000_000_000)).toBe('₫ 1.000.000.000')
  })
})

describe('fmtNav', () => {
  it('always shows exactly 2 decimal places', () => {
    expect(fmtNav(25219)).toBe('₫ 25.219,00')
    expect(fmtNav(25219.5)).toBe('₫ 25.219,50')
  })
  it('makes whole-number NAV values unambiguous (comma suffix shows it is not a decimal)', () => {
    const result = fmtNav(25219)
    expect(result).toContain(',00')
  })
  it('formats zero with decimals', () => {
    expect(fmtNav(0)).toBe('₫ 0,00')
  })
})

describe('fmtUnits', () => {
  it('formats whole units without decimals', () => {
    expect(fmtUnits(2879)).toBe('2.879')
  })
  it('formats fractional units with up to 2 decimal places', () => {
    expect(fmtUnits(2878.83)).toBe('2.878,83')
  })
  it('drops trailing zeros beyond 2 places', () => {
    expect(fmtUnits(2878.8)).toBe('2.878,8')
  })
  it('formats zero', () => {
    expect(fmtUnits(0)).toBe('0')
  })
})

describe('fmtPct', () => {
  it('prefixes positive values with +', () => {
    expect(fmtPct(12.5)).toBe('+12.50%')
  })
  it('does not prefix negative values', () => {
    expect(fmtPct(-3.75)).toBe('-3.75%')
  })
  it('prefixes zero with +', () => {
    expect(fmtPct(0)).toBe('+0.00%')
  })
  it('always shows 2 decimal places', () => {
    expect(fmtPct(1)).toBe('+1.00%')
  })
})
