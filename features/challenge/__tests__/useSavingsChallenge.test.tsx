import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSavingsChallenge } from '../useSavingsChallenge'

// The three things this hook has to get right, none of which a component test
// would reach:
//
//   1. A failed read is not an empty month. `challenge: null` is what makes the
//      card offer the tier picker, so degrading into it would invite the user to
//      start a month that may already be running.
//   2. A tick is optimistic, and a refusal puts back exactly the list that was
//      there — not a re-derived one, which would lose a second tick that landed
//      while the first was in flight.
//   3. A month's answer may not land on a different month. Stepping through
//      months faster than the network replies would otherwise paint August's
//      days onto September.

const NOW = new Date('2026-09-16T00:30:00Z')

const json = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body } as Response)

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW)
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const SEPTEMBER = { challenge_id: 'c-1', year: 2026, month: 9, tier: 1 }

describe('reading a month', () => {
  it('loads the tier and its ticked days', async () => {
    fetchMock.mockReturnValue(json({ challenge: SEPTEMBER, days: [1, 2] }))
    const { result } = renderHook(() => useSavingsChallenge(2026, 9))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.challenge).toEqual(SEPTEMBER)
    expect(result.current.days).toEqual([1, 2])
    // 30,000 + 29,000
    expect(result.current.view.savedVnd).toBe(59_000)
  })

  it('reports a failed read as an error, never as an unstarted month', async () => {
    fetchMock.mockReturnValue(json({ error: 'boom' }, 500))
    const { result } = renderHook(() => useSavingsChallenge(2026, 9))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe(true)
    expect(result.current.challenge).toBeNull()
  })

  it('distinguishes a month with no challenge from one that failed', async () => {
    fetchMock.mockReturnValue(json({ challenge: null, days: [] }))
    const { result } = renderHook(() => useSavingsChallenge(2026, 9))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe(false)
    expect(result.current.challenge).toBeNull()
  })

  it('ignores an answer for a month the user has already left', async () => {
    let settleSeptember: (v: unknown) => void = () => {}
    fetchMock.mockImplementation((url: string) =>
      url.includes('month=9')
        ? new Promise(resolve => { settleSeptember = resolve })
        : json({ challenge: { ...SEPTEMBER, month: 10, tier: 3 }, days: [4] }),
    )

    const { result, rerender } = renderHook(
      ({ month }) => useSavingsChallenge(2026, month),
      { initialProps: { month: 9 } },
    )
    rerender({ month: 10 })
    await waitFor(() => expect(result.current.challenge?.month).toBe(10))

    // September finally answers — long after the user moved on.
    await act(async () => {
      settleSeptember({ ok: true, status: 200, json: async () => ({ challenge: SEPTEMBER, days: [1] }) })
    })
    expect(result.current.challenge?.month).toBe(10)
    expect(result.current.days).toEqual([4])
  })
})

describe('ticking a day', () => {
  const loaded = async (days: number[] = []) => {
    fetchMock.mockReturnValue(json({ challenge: SEPTEMBER, days }))
    const hook = renderHook(() => useSavingsChallenge(2026, 9))
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    fetchMock.mockReset()
    return hook
  }

  it('fills the day in before the server answers', async () => {
    const { result } = await loaded()
    let settle: (v: unknown) => void = () => {}
    fetchMock.mockReturnValue(new Promise(resolve => { settle = resolve }))

    act(() => { void result.current.toggleDay(5) })
    expect(result.current.days).toContain(5)

    await act(async () => { settle({ ok: true, status: 201, json: async () => ({}) }) })
    expect(result.current.days).toContain(5)
  })

  it('puts the day back when the server refuses, and says why', async () => {
    const onError = vi.fn()
    fetchMock.mockReturnValue(json({ challenge: SEPTEMBER, days: [] }))
    const { result } = renderHook(() => useSavingsChallenge(2026, 9, onError))
    await waitFor(() => expect(result.current.loading).toBe(false))

    fetchMock.mockReturnValue(json({ error: 'That day has not arrived yet.' }, 409))
    await act(async () => { await result.current.toggleDay(20) })

    expect(result.current.days).not.toContain(20)
    // The server's own words, not a generic failure — it is the only place the
    // reason exists.
    expect(onError).toHaveBeenCalledWith('That day has not arrived yet.')
  })

  it('un-ticks through DELETE, and restores the day if that fails', async () => {
    const { result } = await loaded([7])
    fetchMock.mockReturnValue(json({ error: 'nope' }, 500))

    await act(async () => { await result.current.toggleDay(7) })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/savings-challenges/c-1/days/7',
      expect.objectContaining({ method: 'DELETE' }),
    )
    expect(result.current.days).toContain(7)
  })

  it('does not lose a second tick when the first one rolls back', async () => {
    const { result } = await loaded()
    let failFirst: (v: unknown) => void = () => {}
    fetchMock
      .mockReturnValueOnce(new Promise(resolve => { failFirst = resolve }))
      .mockReturnValue(json({ day: 6 }, 201))

    act(() => { void result.current.toggleDay(5) })
    await act(async () => { await result.current.toggleDay(6) })
    await act(async () => {
      failFirst({ ok: false, status: 500, json: async () => ({ error: 'nope' }) })
    })

    // Day 5 is gone (it was refused) and day 6 survived (it was not).
    expect(result.current.days).not.toContain(5)
    expect(result.current.days).toContain(6)
  })

  it('does nothing at all with no challenge to tick against', async () => {
    fetchMock.mockReturnValue(json({ challenge: null, days: [] }))
    const { result } = renderHook(() => useSavingsChallenge(2026, 9))
    await waitFor(() => expect(result.current.loading).toBe(false))
    fetchMock.mockReset()

    await act(async () => { expect(await result.current.toggleDay(1)).toBe(false) })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('choosing and abandoning', () => {
  it('starts the month and clears any stale day list', async () => {
    fetchMock.mockReturnValue(json({ challenge: null, days: [] }))
    const { result } = renderHook(() => useSavingsChallenge(2026, 9))
    await waitFor(() => expect(result.current.loading).toBe(false))

    fetchMock.mockReturnValue(json({ ...SEPTEMBER, tier: 2 }, 201))
    await act(async () => { expect(await result.current.start(2)).toBe(true) })

    expect(result.current.challenge?.tier).toBe(2)
    expect(result.current.days).toEqual([])
    expect(result.current.view.targetVnd).toBe(2_325_000)
  })

  it('relays the lock refusal rather than a generic failure', async () => {
    const onError = vi.fn()
    fetchMock.mockReturnValue(json({ challenge: SEPTEMBER, days: [3] }))
    const { result } = renderHook(() => useSavingsChallenge(2026, 9, onError))
    await waitFor(() => expect(result.current.loading).toBe(false))

    fetchMock.mockReturnValue(json(
      { error: 'the tier is locked once a day has been set aside', code: 'challenge_locked' },
      409,
    ))
    await act(async () => { expect(await result.current.retier(3)).toBe(false) })

    expect(onError).toHaveBeenCalledWith('the tier is locked once a day has been set aside')
    // The tier on screen is still the real one.
    expect(result.current.challenge?.tier).toBe(1)
  })

  it('empties the month when it is abandoned', async () => {
    fetchMock.mockReturnValue(json({ challenge: SEPTEMBER, days: [] }))
    const { result } = renderHook(() => useSavingsChallenge(2026, 9))
    await waitFor(() => expect(result.current.loading).toBe(false))

    fetchMock.mockReturnValue(json(null, 204))
    await act(async () => { expect(await result.current.abandon()).toBe(true) })

    expect(result.current.challenge).toBeNull()
    expect(result.current.view.targetVnd).toBe(0)
  })
})
