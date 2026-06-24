import { describe, it, expect, vi } from 'vitest'
import { fetchNetWorthHistory, RANGE_PARAM, TIME_RANGES } from '../netWorthHistory'

describe('fetchNetWorthHistory', () => {
  it('maps every range to its API param in the request URL', async () => {
    for (const range of TIME_RANGES) {
      const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
      await fetchNetWorthHistory(range, fetchFn as never)
      expect(fetchFn).toHaveBeenCalledWith(
        `/api/v1/dashboard/history?range=${RANGE_PARAM[range]}`,
        { cache: 'no-store' },
      )
    }
  })

  it('returns the parsed points on a 200', async () => {
    const points = [{ label: 'Jan', value: 10 }, { label: 'Feb', value: 20 }]
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => points })
    await expect(fetchNetWorthHistory('1Y', fetchFn as never)).resolves.toEqual(points)
  })

  it('returns [] on a non-ok response', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) })
    await expect(fetchNetWorthHistory('1Y', fetchFn as never)).resolves.toEqual([])
  })

  it('returns [] when the fetch rejects', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network'))
    await expect(fetchNetWorthHistory('1Y', fetchFn as never)).resolves.toEqual([])
  })
})
