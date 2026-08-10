import { describe, it, expect } from 'vitest'
import {
  ASSET_SUBTYPE_FIELDS,
  SUBTYPE_EXCLUSIVE_FIELDS,
  subtypeResetFields,
  type SubtypeAssetType,
} from '../assetTypeFields'

const TYPES: SubtypeAssetType[] = ['fund', 'bank', 'gold', 'stock']

describe('ASSET_SUBTYPE_FIELDS (#593)', () => {
  it('gives each asset type a field set drawn from the exclusive columns', () => {
    for (const type of TYPES) {
      for (const field of ASSET_SUBTYPE_FIELDS[type]) {
        expect(SUBTYPE_EXCLUSIVE_FIELDS).toContain(field)
      }
    }
  })

  it('keeps the deposit-only columns out of every non-bank type', () => {
    for (const field of ['interest_rate', 'expiry_date', 'bank_code', 'interest_earned_vnd', 'deposit_group_id', 'top_up_lock_days']) {
      expect(ASSET_SUBTYPE_FIELDS.bank).toContain(field)
      expect(ASSET_SUBTYPE_FIELDS.fund).not.toContain(field)
      expect(ASSET_SUBTYPE_FIELDS.gold).not.toContain(field)
      expect(ASSET_SUBTYPE_FIELDS.stock).not.toContain(field)
    }
  })

  it('keeps fund_id to funds, and unit columns off bank deposits', () => {
    expect(ASSET_SUBTYPE_FIELDS.fund).toContain('fund_id')
    expect(ASSET_SUBTYPE_FIELDS.gold).not.toContain('fund_id')
    expect(ASSET_SUBTYPE_FIELDS.bank).not.toContain('fund_id')
    expect(ASSET_SUBTYPE_FIELDS.bank).not.toContain('units')
    expect(ASSET_SUBTYPE_FIELDS.bank).not.toContain('unit_price')
    for (const type of ['fund', 'gold', 'stock'] as const) {
      expect(ASSET_SUBTYPE_FIELDS[type]).toContain('units')
      expect(ASSET_SUBTYPE_FIELDS[type]).toContain('unit_price')
    }
  })
})

describe('subtypeResetFields (#593)', () => {
  it('resets nothing when the type is unchanged', () => {
    for (const type of TYPES) {
      expect(subtypeResetFields(type, type)).toEqual({})
    }
  })

  it('resets nothing when the previous type is unknown', () => {
    // A legacy row with a null asset_type has no old subtype to clear.
    expect(subtypeResetFields(null, 'fund')).toEqual({})
    expect(subtypeResetFields(undefined, 'bank')).toEqual({})
  })

  // Every transition, in both directions: the whole exclusive set is nulled, so
  // no field of the old subtype can survive the change.
  for (const from of TYPES) {
    for (const to of TYPES) {
      if (from === to) continue
      it(`clears every subtype column on ${from} -> ${to}`, () => {
        const reset = subtypeResetFields(from, to)
        expect(Object.keys(reset).sort()).toEqual([...SUBTYPE_EXCLUSIVE_FIELDS].sort())
        expect(Object.values(reset).every((v) => v === null)).toBe(true)
      })
    }
  }

  it('clears the bank metadata a bank -> fund/gold change leaves behind', () => {
    for (const to of ['fund', 'gold'] as const) {
      const reset = subtypeResetFields('bank', to)
      expect(reset).toMatchObject({
        interest_rate: null, expiry_date: null, bank_code: null,
        interest_earned_vnd: null, deposit_group_id: null,
      })
    }
  })

  it('clears the units a gold -> bank change leaves behind', () => {
    expect(subtypeResetFields('gold', 'bank')).toMatchObject({ units: null, unit_price: null })
  })

  it('clears the fund link a fund -> bank/gold change leaves behind', () => {
    expect(subtypeResetFields('fund', 'bank')).toMatchObject({ fund_id: null })
    expect(subtypeResetFields('fund', 'gold')).toMatchObject({ fund_id: null })
  })

  it('returns a fresh object each call', () => {
    const a = subtypeResetFields('bank', 'fund')
    a.units = 1 as unknown as null
    expect(subtypeResetFields('bank', 'fund').units).toBeNull()
  })
})
