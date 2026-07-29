import { describe, it, expect } from 'vitest'
import { parseFundPayload } from '../fundPayload'

// POST /api/funds and PUT /api/funds/[id] carried identical copies of this
// validation, so a rule could be tightened on one and missed on the other
// (#572). The create/update difference is real and stays explicit: create always
// writes DCA fields, update only writes them when the caller sends is_dca.

const valid = {
  name: '  VFMVF1 Equity  ',
  code: ' vfmvf1 ',
  fund_type: 'equity',
  nav: 36120,
  nav_source_url: null,
}

const parse = (body: Record<string, unknown>, mode: 'create' | 'update' = 'create') =>
  parseFundPayload(body, mode)

async function rejection(body: Record<string, unknown>, mode: 'create' | 'update' = 'create') {
  const result = parse(body, mode)
  if (result.ok) throw new Error('expected the payload to be rejected')
  return { status: result.response.status, ...(await result.response.json()) }
}

describe('parseFundPayload — common fields', () => {
  it('normalizes name and code', () => {
    const result = parse(valid)

    expect(result.ok && result.fund).toMatchObject({
      name: 'VFMVF1 Equity',   // trimmed
      code: 'VFMVF1',          // trimmed and upper-cased
      fund_type: 'equity',
      nav: 36120,
    })
  })

  it('requires a name', async () => {
    expect(await rejection({ ...valid, name: '   ' })).toEqual({ status: 400, error: 'Name is required' })
    expect(await rejection({ ...valid, name: undefined })).toEqual({ status: 400, error: 'Name is required' })
    expect(await rejection({ ...valid, name: 42 })).toEqual({ status: 400, error: 'Name is required' })
  })

  it('caps the name at 255 characters, after trimming', async () => {
    expect(parse({ ...valid, name: `  ${'a'.repeat(255)}  ` }).ok).toBe(true)
    expect((await rejection({ ...valid, name: 'a'.repeat(256) })).status).toBe(400)
  })

  it('requires a code and caps it at 50', async () => {
    expect(await rejection({ ...valid, code: '' })).toEqual({ status: 400, error: 'Code is required' })
    expect((await rejection({ ...valid, code: 'a'.repeat(51) })).status).toBe(400)
  })

  it('requires a known fund type', async () => {
    for (const fund_type of ['balanced', 'equity', 'debt', 'gold']) {
      expect(parse({ ...valid, fund_type }).ok, fund_type).toBe(true)
    }
    expect(await rejection({ ...valid, fund_type: 'crypto' })).toEqual({ status: 400, error: 'Fund type is required' })
    expect((await rejection({ ...valid, fund_type: undefined })).status).toBe(400)
  })

  // Number('Infinity') is Infinity and would slip past a bare `< 0.01` check,
  // then reach the DB numeric column.
  it('requires a finite NAV of at least 0.01', async () => {
    expect((await rejection({ ...valid, nav: 'Infinity' })).status).toBe(400)
    expect((await rejection({ ...valid, nav: 0 })).status).toBe(400)
    expect((await rejection({ ...valid, nav: -1 })).status).toBe(400)
    expect((await rejection({ ...valid, nav: 'abc' })).status).toBe(400)
    expect(parse({ ...valid, nav: '0.01' }).ok).toBe(true)  // numeric strings still coerce
  })

  it('rejects a dca_goal_id that is not a UUID', async () => {
    expect(await rejection({ ...valid, is_dca: true, dca_goal_id: 'not-a-uuid' }))
      .toEqual({ status: 400, error: 'Invalid goal' })
  })

  // The stored URL is fetched server-side later, so the allowlist is what stops
  // it being pointed at an internal address.
  it('rejects a NAV source URL outside the vendor allowlist', async () => {
    expect((await rejection({ ...valid, nav_source_url: 'http://169.254.169.254/latest/meta-data' })).status).toBe(400)
    expect((await rejection({ ...valid, nav_source_url: 'https://evil.example.com/nav' })).status).toBe(400)
  })
})

const GOAL = '123e4567-e89b-12d3-a456-426614174000'

describe('parseFundPayload — create mode', () => {
  it('always returns DCA fields, defaulting to off', () => {
    const result = parse(valid, 'create')

    expect(result.ok && result.dca).toEqual({
      is_dca: false,
      dca_monthly_amount_vnd: null,
      dca_goal_id: null,
    })
  })

  it('keeps the amount and goal when DCA is on', () => {
    const result = parse({ ...valid, is_dca: true, dca_monthly_amount_vnd: 2_000_000, dca_goal_id: GOAL }, 'create')

    expect(result.ok && result.dca).toEqual({
      is_dca: true,
      dca_monthly_amount_vnd: 2_000_000,
      dca_goal_id: GOAL,
    })
  })

  it('drops the amount and goal when DCA is off', () => {
    const result = parse({ ...valid, is_dca: false, dca_monthly_amount_vnd: 2_000_000, dca_goal_id: GOAL }, 'create')

    expect(result.ok && result.dca).toEqual({ is_dca: false, dca_monthly_amount_vnd: null, dca_goal_id: null })
  })

  // Checked by *presence*, not truthiness: a sent 0 is a mistake worth a 400,
  // not something to store as null. The column is BIGINT, so a fraction would
  // be a DB type error (500) rather than a validation failure.
  it('rejects a zero or fractional DCA amount', async () => {
    expect((await rejection({ ...valid, is_dca: true, dca_monthly_amount_vnd: 0 })).status).toBe(400)
    expect((await rejection({ ...valid, is_dca: true, dca_monthly_amount_vnd: 1.5 })).status).toBe(400)
    expect((await rejection({ ...valid, is_dca: true, dca_monthly_amount_vnd: -100 })).status).toBe(400)
  })

  it('leaves the amount null when DCA is on but no amount is sent yet', () => {
    const result = parse({ ...valid, is_dca: true }, 'create')

    expect(result.ok && result.dca?.dca_monthly_amount_vnd).toBeNull()
  })
})

describe('parseFundPayload — update mode', () => {
  // The Add/Edit form sends only name/code/type/nav, so a name edit must
  // preserve the existing DCA config rather than silently wiping it.
  it('returns no DCA fields at all when is_dca is absent', () => {
    const result = parse(valid, 'update')

    expect(result.ok && result.dca).toBeNull()
  })

  it('returns DCA fields when is_dca is sent', () => {
    const result = parse({ ...valid, is_dca: true, dca_monthly_amount_vnd: 500_000, dca_goal_id: GOAL }, 'update')

    expect(result.ok && result.dca).toEqual({
      is_dca: true,
      dca_monthly_amount_vnd: 500_000,
      dca_goal_id: GOAL,
    })
  })

  it('rejects a non-boolean is_dca', async () => {
    for (const is_dca of [null, 'false', 0, 1, 'true']) {
      expect((await rejection({ ...valid, is_dca }, 'update')).status, String(is_dca)).toBe(400)
    }
  })

  // Asymmetric with create, which treats any non-`true` value as off rather
  // than rejecting it. Preserved as-is: changing it is a behaviour change, not
  // a refactor.
  it('create does not reject a non-boolean is_dca, matching existing behaviour', () => {
    const result = parse({ ...valid, is_dca: 'yes' }, 'create')

    expect(result.ok && result.dca?.is_dca).toBe(false)
  })
})
