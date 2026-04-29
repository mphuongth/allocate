import { describe, it, expect } from 'vitest'
import { parseExcelPaste } from '../parseExcelPaste'

const makeRow = (date: string, amount = '5000000', skip = '4900000', nav = '25219', units = '198.2') =>
  [date, amount, skip, nav, units].join('\t')

describe('parseExcelPaste', () => {
  it('parses ISO date format (YYYY-MM-DD)', () => {
    const [row] = parseExcelPaste(makeRow('2023-07-15'))
    expect(row.investment_date).toBe('2023-07-15')
    expect(row.error).toBeUndefined()
  })

  it('parses D/M/YYYY full date format', () => {
    const [row] = parseExcelPaste(makeRow('15/7/2023'))
    expect(row.investment_date).toBe('2023-07-15')
  })

  it('zero-pads single-digit day and month in D/M/YYYY', () => {
    const [row] = parseExcelPaste(makeRow('5/3/2024'))
    expect(row.investment_date).toBe('2024-03-05')
  })

  it('parses M/YYYY month-only format to first of month', () => {
    const [row] = parseExcelPaste(makeRow('7/2023'))
    expect(row.investment_date).toBe('2023-07-01')
  })

  it('parses numeric columns correctly', () => {
    const [row] = parseExcelPaste(makeRow('2023-07-15', '5,000,000', '4,900,000', '25,219', '198.2'))
    expect(row.amount_vnd).toBe(5000000)
    expect(row.unit_price).toBe(25219)
    expect(row.units).toBe(198.2)
  })

  it('filters out rows with fewer than 5 columns', () => {
    const raw = '2023-07-15\t5000000\t4900000'
    expect(parseExcelPaste(raw)).toHaveLength(0)
  })

  it('sets error on rows with unparseable date', () => {
    const [row] = parseExcelPaste(makeRow('not-a-date'))
    expect(row.error).toBe('Cannot parse row')
  })

  it('sets error on rows with NaN amount', () => {
    const [row] = parseExcelPaste(makeRow('2023-07-15', 'abc'))
    expect(row.error).toBe('Cannot parse row')
  })

  it('handles multi-row paste and returns correct count', () => {
    const raw = [makeRow('2023-07-15'), makeRow('2023-08-15'), makeRow('2023-09-15')].join('\n')
    expect(parseExcelPaste(raw)).toHaveLength(3)
  })

  it('trims leading/trailing whitespace from input', () => {
    const raw = `\n${makeRow('2023-07-15')}\n`
    expect(parseExcelPaste(raw)).toHaveLength(1)
  })
})
