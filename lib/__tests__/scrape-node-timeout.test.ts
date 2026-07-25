import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'

// The Dragon Capital scraper fetches over Node https (custom agent). Its request
// deadline must be an ABSOLUTE total-time limit, not a per-socket inactivity
// timeout — otherwise an upstream that dribbles a byte every few ms keeps the
// request alive forever (#515, review finding 4).
//
// This mocked https server does exactly that: it emits 'data' every 5 ms and
// never emits 'end'. A real inactivity timeout would never fire; the absolute
// deadline must still destroy the request.
vi.mock('https', () => {
  class FakeAgent {}
  function get(_opts: unknown, cb: (res: EventEmitter) => void) {
    const req = new EventEmitter() as EventEmitter & { destroy: (e?: Error) => void }
    const drip = setInterval(() => res.emit('data', 'x'), 5)
    req.destroy = (e?: Error) => {
      clearInterval(drip)
      req.emit('error', e ?? new Error('destroyed'))
    }
    const res = new EventEmitter()
    setTimeout(() => cb(res), 1)
    return req
  }
  return { default: { get, Agent: FakeAgent } }
})

import { fetchWithNodeHttps } from '../scrape-fund-nav'

describe('fetchWithNodeHttps — absolute deadline (not inactivity)', () => {
  it('destroys a request that keeps dribbling data past the deadline', async () => {
    // 30 ms deadline vs a 5 ms drip: an inactivity timeout would never fire, so
    // rejecting proves the deadline is absolute.
    await expect(
      fetchWithNodeHttps('https://www.dragoncapital.com.vn/x', { timeoutMs: 30 }),
    ).rejects.toThrow(/timed out/i)
  })

  it('enforces the response-size cap on the streamed body', async () => {
    await expect(
      fetchWithNodeHttps('https://www.dragoncapital.com.vn/x', { timeoutMs: 5_000, maxBytes: 20 }),
    ).rejects.toThrow(/exceeded/i)
  })
})
