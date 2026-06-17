import { describe, it, expect } from 'vitest'
import { linkedSavingFor, type RecurringLinkCandidate } from '../recurringLink'

const cand = (over: Partial<RecurringLinkCandidate> = {}): RecurringLinkCandidate => ({
  saving_id: 's1',
  name: 'MB Term 6M',
  amount_vnd: 2_000_000,
  fulfilled: false,
  linkedDepositKey: null,
  ...over,
})

describe('linkedSavingFor', () => {
  it('returns null when there are no candidates', () => {
    expect(linkedSavingFor('MB Term 6M', [], null)).toBeNull()
  })

  it('returns null when every candidate is already fulfilled this month', () => {
    expect(linkedSavingFor('MB Term 6M', [cand({ fulfilled: true })], null)).toBeNull()
  })

  it('1. explicit link wins outright even amid other candidates', () => {
    const res = linkedSavingFor(
      'Whatever',
      [
        cand({ saving_id: 's1', name: 'ACB' }),
        cand({ saving_id: 's2', name: 'MB', linkedDepositKey: 'dep-key' }),
      ],
      'dep-key',
    )
    expect(res?.reason).toBe('explicit')
    expect(res?.ambiguous).toBe(false)
    expect(res?.match?.saving_id).toBe('s2')
  })

  it('2. a single normalized name match wins', () => {
    const res = linkedSavingFor(
      'MB Term 6M',
      [cand({ saving_id: 's1', name: 'mb term 6m' }), cand({ saving_id: 's2', name: 'ACB Savings' })],
      null,
    )
    expect(res?.reason).toBe('name')
    expect(res?.match?.saving_id).toBe('s1')
  })

  it('3. a sole candidate is matched when no name signal conflicts', () => {
    const res = linkedSavingFor('Totally different', [cand({ saving_id: 's1', name: 'VCB' })], null)
    expect(res?.reason).toBe('sole')
    expect(res?.match?.saving_id).toBe('s1')
  })

  it('is ambiguous with two non-matching candidates and no link', () => {
    const res = linkedSavingFor(
      'Nope',
      [cand({ saving_id: 's1', name: 'VCB' }), cand({ saving_id: 's2', name: 'ACB' })],
      null,
    )
    expect(res?.ambiguous).toBe(true)
    expect(res?.match).toBeNull()
    expect(res?.candidates.map((c) => c.saving_id)).toEqual(['s1', 's2'])
  })

  it('is ambiguous when two candidates both name-match — shortlist is the matches', () => {
    const res = linkedSavingFor(
      'MB Term',
      [
        cand({ saving_id: 's1', name: 'MB Term 6M' }),
        cand({ saving_id: 's2', name: 'MB Term 12M' }),
        cand({ saving_id: 's3', name: 'ACB Savings' }),
      ],
      null,
    )
    expect(res?.ambiguous).toBe(true)
    expect(res?.candidates.map((c) => c.saving_id)).toEqual(['s1', 's2'])
  })

  it('ignores fulfilled candidates when forming the pool', () => {
    const res = linkedSavingFor(
      'Anything',
      [cand({ saving_id: 's1', name: 'VCB', fulfilled: true }), cand({ saving_id: 's2', name: 'ACB' })],
      null,
    )
    // s1 drops out → s2 becomes the sole candidate.
    expect(res?.reason).toBe('sole')
    expect(res?.match?.saving_id).toBe('s2')
  })
})
