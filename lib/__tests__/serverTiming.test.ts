import { describe, it, expect } from 'vitest'
import { createServerTiming } from '../serverTiming'

// The dashboard overview went from ~0.3 s warm to over 30 s after the app had
// sat idle, and nothing in the response said where the time went. Server-Timing
// is the standard header for exactly that: the browser's network panel and
// PerformanceResourceTiming.serverTiming both read it, with no log access needed.

/** A clock that advances only when told to, so durations are exact. */
function fakeClock() {
  let now = 1_000
  return { now: () => now, advance: (ms: number) => { now += ms } }
}

describe('createServerTiming', () => {
  it('reports each phase with its duration, in the order they ran', async () => {
    const clock = fakeClock()
    const timing = createServerTiming(clock.now)

    await timing.measure('auth', async () => { clock.advance(12) })
    await timing.measure('reads', async () => { clock.advance(340.25) })

    expect(timing.header()).toBe('auth;dur=12.0, reads;dur=340.3, total;dur=352.3')
  })

  it('hands back what the measured work returned', async () => {
    const timing = createServerTiming(fakeClock().now)
    await expect(timing.measure('reads', async () => 42)).resolves.toBe(42)
  })

  it('still records a phase whose work rejects, and rethrows', async () => {
    // A slow failure is the case most worth seeing — it must not vanish from
    // the header just because it threw.
    const clock = fakeClock()
    const timing = createServerTiming(clock.now)

    await expect(
      timing.measure('reads', async () => { clock.advance(30); throw new Error('connection reset') }),
    ).rejects.toThrow('connection reset')

    expect(timing.header()).toBe('reads;dur=30.0, total;dur=30.0')
  })

  it('counts time spent between phases in the total', async () => {
    // total is wall-clock since the timer was created, not the sum of phases —
    // the gap is the pure computation between the awaited steps.
    const clock = fakeClock()
    const timing = createServerTiming(clock.now)

    await timing.measure('reads', async () => { clock.advance(100) })
    clock.advance(50)

    expect(timing.header()).toBe('reads;dur=100.0, total;dur=150.0')
  })
})
