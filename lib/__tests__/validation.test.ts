import { describe, it, expect } from 'vitest'
import {
  validateAmount,
  validateRate,
  validateText,
  validateNotes,
  validateUUID,
  validateDate,
  validateYearMonth,
  validateEnum,
  validateBankCode,
  validateInteger,
  validatePositiveIntParam,
  ValidationError,
} from '../validation'

describe('validateBankCode', () => {
  it('accepts a short uppercase alphanumeric code', () => {
    expect(validateBankCode('VCB', 'bank_code')).toBe('VCB')
    expect(validateBankCode('MB', 'bank_code')).toBe('MB')
  })

  it('rejects lowercase, punctuation, or over-long codes', () => {
    expect(() => validateBankCode('vcb', 'bank_code')).toThrow(ValidationError)
    expect(() => validateBankCode('MB BANK', 'bank_code')).toThrow(ValidationError)
    expect(() => validateBankCode('A', 'bank_code')).toThrow(ValidationError)
    expect(() => validateBankCode('TOOLONGBANKCODE', 'bank_code')).toThrow(ValidationError)
    expect(() => validateBankCode(123, 'bank_code')).toThrow(ValidationError)
  })
})

describe('validateAmount', () => {
  it('accepts a positive finite number', () => {
    expect(validateAmount(1000, 'amount_vnd')).toBe(1000)
  })

  it('accepts zero', () => {
    expect(validateAmount(0, 'amount_vnd')).toBe(0)
  })

  it('accepts a numeric string', () => {
    expect(validateAmount('1500', 'amount_vnd')).toBe(1500)
  })

  it('rejects Infinity', () => {
    expect(() => validateAmount(Infinity, 'amount_vnd')).toThrow(ValidationError)
  })

  it('rejects -Infinity', () => {
    expect(() => validateAmount(-Infinity, 'amount_vnd')).toThrow(ValidationError)
  })

  it('rejects NaN', () => {
    expect(() => validateAmount(NaN, 'amount_vnd')).toThrow(ValidationError)
  })

  it('rejects a negative number', () => {
    expect(() => validateAmount(-1, 'amount_vnd')).toThrow(ValidationError)
  })

  it('rejects a non-finite string', () => {
    expect(() => validateAmount('Infinity', 'amount_vnd')).toThrow(ValidationError)
  })

  it('rejects values above MAX_SAFE_INTEGER', () => {
    expect(() => validateAmount(Number.MAX_SAFE_INTEGER + 1, 'amount_vnd')).toThrow(ValidationError)
  })

  it('rejects undefined / null', () => {
    expect(() => validateAmount(undefined, 'amount_vnd')).toThrow(ValidationError)
    expect(() => validateAmount(null, 'amount_vnd')).toThrow(ValidationError)
  })

  it('mentions the field name in the error', () => {
    try {
      validateAmount(-1, 'salary_vnd')
    } catch (e) {
      expect((e as ValidationError).message).toContain('salary_vnd')
    }
  })
})

describe('validateRate', () => {
  it('accepts typical positive interest rates', () => {
    expect(validateRate(7.5, 'interest_rate')).toBe(7.5)
  })

  it('accepts negative real rates (in the allowed range)', () => {
    expect(validateRate(-2, 'interest_rate')).toBe(-2)
  })

  it('accepts zero', () => {
    expect(validateRate(0, 'interest_rate')).toBe(0)
  })

  it('rejects Infinity', () => {
    expect(() => validateRate(Infinity, 'interest_rate')).toThrow(ValidationError)
  })

  it('rejects NaN', () => {
    expect(() => validateRate(NaN, 'interest_rate')).toThrow(ValidationError)
  })

  it('rejects rates below -100', () => {
    expect(() => validateRate(-200, 'interest_rate')).toThrow(ValidationError)
  })

  it('rejects rates above 1000', () => {
    expect(() => validateRate(5000, 'interest_rate')).toThrow(ValidationError)
  })
})

describe('validateText', () => {
  it('accepts a normal string and trims whitespace', () => {
    expect(validateText('  hello  ', 'goal_name')).toBe('hello')
  })

  it('rejects an empty string after trim', () => {
    expect(() => validateText('   ', 'goal_name')).toThrow(ValidationError)
  })

  it('rejects non-string types', () => {
    expect(() => validateText(123, 'goal_name')).toThrow(ValidationError)
    expect(() => validateText(undefined, 'goal_name')).toThrow(ValidationError)
  })

  it('rejects strings longer than max (default 255)', () => {
    const long = 'a'.repeat(256)
    expect(() => validateText(long, 'goal_name')).toThrow(ValidationError)
  })

  it('respects custom max', () => {
    expect(() => validateText('abcde', 'tag', { max: 3 })).toThrow(ValidationError)
    expect(validateText('abc', 'tag', { max: 3 })).toBe('abc')
  })
})

describe('validateNotes', () => {
  it('accepts a normal string', () => {
    expect(validateNotes('Some notes here')).toBe('Some notes here')
  })

  it('returns null for empty/whitespace-only input (notes are optional)', () => {
    expect(validateNotes('')).toBeNull()
    expect(validateNotes('   ')).toBeNull()
    expect(validateNotes(null)).toBeNull()
    expect(validateNotes(undefined)).toBeNull()
  })

  it('rejects strings longer than 2000 chars', () => {
    expect(() => validateNotes('a'.repeat(2001))).toThrow(ValidationError)
  })

  it('rejects non-string values that are not nullish', () => {
    expect(() => validateNotes(42)).toThrow(ValidationError)
  })
})

describe('validateUUID', () => {
  it('accepts a v4 UUID', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    expect(validateUUID(uuid, 'goal_id')).toBe(uuid)
  })

  it('accepts a UUID with uppercase letters', () => {
    const uuid = '550E8400-E29B-41D4-A716-446655440000'
    expect(validateUUID(uuid, 'goal_id')).toBe(uuid)
  })

  it('rejects a non-UUID string', () => {
    expect(() => validateUUID('not-a-uuid', 'goal_id')).toThrow(ValidationError)
  })

  it('rejects empty string', () => {
    expect(() => validateUUID('', 'goal_id')).toThrow(ValidationError)
  })

  it('rejects non-string values', () => {
    expect(() => validateUUID(123, 'goal_id')).toThrow(ValidationError)
    expect(() => validateUUID(undefined, 'goal_id')).toThrow(ValidationError)
  })

  it('rejects a UUID with wrong segment lengths', () => {
    expect(() => validateUUID('550e8400-e29b-41d4-a716-44665544000', 'goal_id')).toThrow(ValidationError)
  })
})

describe('validateDate', () => {
  it('accepts a YYYY-MM-DD date', () => {
    expect(validateDate('2026-05-27', 'investment_date')).toBe('2026-05-27')
  })

  it('rejects a malformed date string', () => {
    expect(() => validateDate('not-a-date', 'investment_date')).toThrow(ValidationError)
  })

  it('rejects a date with wrong format (e.g. DD/MM/YYYY)', () => {
    expect(() => validateDate('27/05/2026', 'investment_date')).toThrow(ValidationError)
  })

  it('rejects an invalid calendar date', () => {
    expect(() => validateDate('2026-02-30', 'investment_date')).toThrow(ValidationError)
  })

  it('rejects non-string values', () => {
    expect(() => validateDate(20260527, 'investment_date')).toThrow(ValidationError)
    expect(() => validateDate(undefined, 'investment_date')).toThrow(ValidationError)
  })
})

describe('validateYearMonth', () => {
  it('accepts a YYYY-MM value', () => {
    expect(validateYearMonth('2028-06', 'target_date')).toBe('2028-06')
  })

  it('rejects a YYYY-MM-DD value (too specific)', () => {
    expect(() => validateYearMonth('2028-06-15', 'target_date')).toThrow(ValidationError)
  })

  it('rejects a value with an invalid month', () => {
    expect(() => validateYearMonth('2028-13', 'target_date')).toThrow(ValidationError)
    expect(() => validateYearMonth('2028-00', 'target_date')).toThrow(ValidationError)
  })

  it('rejects non-string values', () => {
    expect(() => validateYearMonth(202806, 'target_date')).toThrow(ValidationError)
    expect(() => validateYearMonth(undefined, 'target_date')).toThrow(ValidationError)
  })
})

describe('validateEnum', () => {
  it('returns the value when it is in the allowed set', () => {
    expect(validateEnum('fund', ['fund', 'bank', 'stock', 'gold'] as const, 'asset_type')).toBe('fund')
  })

  it('rejects a value not in the set', () => {
    expect(() => validateEnum('crypto', ['fund', 'bank', 'stock', 'gold'] as const, 'asset_type')).toThrow(ValidationError)
  })

  it('rejects non-string values', () => {
    expect(() => validateEnum(123, ['fund', 'bank'] as const, 'asset_type')).toThrow(ValidationError)
  })
})

describe('validateInteger', () => {
  it('accepts a whole number', () => {
    expect(validateInteger(5, 'month')).toBe(5)
  })

  it('accepts a whole numeric string', () => {
    expect(validateInteger('2026', 'year')).toBe(2026)
  })

  it('accepts a signed integer string and trims whitespace', () => {
    expect(validateInteger(' -3 ', 'n')).toBe(-3)
    expect(validateInteger('+7', 'n')).toBe(7)
  })

  it('rejects a mixed alphanumeric string (e.g. 1abc)', () => {
    expect(() => validateInteger('1abc', 'month')).toThrow(ValidationError)
    expect(() => validateInteger('abc', 'month')).toThrow(ValidationError)
  })

  it('rejects a fractional value (number or string)', () => {
    expect(() => validateInteger(1.5, 'month')).toThrow(ValidationError)
    expect(() => validateInteger('1.5', 'month')).toThrow(ValidationError)
  })

  it('rejects NaN and Infinity', () => {
    expect(() => validateInteger(NaN, 'month')).toThrow(ValidationError)
    expect(() => validateInteger(Infinity, 'month')).toThrow(ValidationError)
    expect(() => validateInteger(-Infinity, 'month')).toThrow(ValidationError)
    expect(() => validateInteger('Infinity', 'month')).toThrow(ValidationError)
  })

  it('rejects values beyond the safe-integer range', () => {
    expect(() => validateInteger(Number.MAX_SAFE_INTEGER + 1, 'n')).toThrow(ValidationError)
    expect(() => validateInteger('9007199254740993', 'n')).toThrow(ValidationError)
  })

  it('rejects null, undefined, empty string, and non-numeric types', () => {
    expect(() => validateInteger(null, 'month')).toThrow(ValidationError)
    expect(() => validateInteger(undefined, 'month')).toThrow(ValidationError)
    expect(() => validateInteger('', 'month')).toThrow(ValidationError)
    expect(() => validateInteger('  ', 'month')).toThrow(ValidationError)
    expect(() => validateInteger(true, 'month')).toThrow(ValidationError)
    expect(() => validateInteger({}, 'month')).toThrow(ValidationError)
  })

  it('enforces the min boundary', () => {
    expect(validateInteger(1, 'month', { min: 1, max: 12 })).toBe(1)
    expect(() => validateInteger(0, 'month', { min: 1, max: 12 })).toThrow(ValidationError)
  })

  it('enforces the max boundary', () => {
    expect(validateInteger(12, 'month', { min: 1, max: 12 })).toBe(12)
    expect(() => validateInteger(13, 'month', { min: 1, max: 12 })).toThrow(ValidationError)
  })

  it('mentions the field name in the error', () => {
    expect(() => validateInteger('x', 'year')).toThrow(/year/)
  })
})

describe('validatePositiveIntParam', () => {
  it('returns the fallback when the param is absent or empty', () => {
    expect(validatePositiveIntParam(null, 'page', { fallback: 1 })).toBe(1)
    expect(validatePositiveIntParam(undefined, 'page', { fallback: 1 })).toBe(1)
    expect(validatePositiveIntParam('', 'page', { fallback: 1 })).toBe(1)
    expect(validatePositiveIntParam('   ', 'page', { fallback: 1 })).toBe(1)
  })

  it('accepts a positive integer string', () => {
    expect(validatePositiveIntParam('3', 'page', { fallback: 1 })).toBe(3)
  })

  it('rejects non-integer garbage instead of silently defaulting', () => {
    expect(() => validatePositiveIntParam('abc', 'page', { fallback: 1 })).toThrow(ValidationError)
    expect(() => validatePositiveIntParam('1abc', 'page', { fallback: 1 })).toThrow(ValidationError)
    expect(() => validatePositiveIntParam('NaN', 'page', { fallback: 1 })).toThrow(ValidationError)
    expect(() => validatePositiveIntParam('Infinity', 'page', { fallback: 1 })).toThrow(ValidationError)
    expect(() => validatePositiveIntParam('2.5', 'page', { fallback: 1 })).toThrow(ValidationError)
  })

  it('rejects zero and negative values (must be positive)', () => {
    expect(() => validatePositiveIntParam('0', 'page', { fallback: 1 })).toThrow(ValidationError)
    expect(() => validatePositiveIntParam('-5', 'page', { fallback: 1 })).toThrow(ValidationError)
  })

  it('clamps to the documented max when one is given', () => {
    expect(validatePositiveIntParam('5000', 'limit', { fallback: 20, max: 1000 })).toBe(1000)
    expect(validatePositiveIntParam('50', 'limit', { fallback: 20, max: 1000 })).toBe(50)
  })

  it('does not clamp when no max is given (page can be large)', () => {
    expect(validatePositiveIntParam('999999', 'page', { fallback: 1 })).toBe(999999)
  })
})

describe('ValidationError', () => {
  it('has a status of 400', () => {
    const err = new ValidationError('bad input')
    expect(err.status).toBe(400)
    expect(err.message).toBe('bad input')
    expect(err.name).toBe('ValidationError')
  })
})
