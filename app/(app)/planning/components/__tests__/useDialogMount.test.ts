import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDialogMount } from '../useDialogMount'

// Every sheet and dialog in the app keeps itself in the DOM for ~220ms after
// `open` goes false so its exit animation can play. That was hand-rolled in ten
// files as an effect that called setMounted(true) synchronously — the shape
// react-hooks/set-state-in-effect flags, and 14 of the 28 warnings in #537.
//
// The state is derivable: mounted = open || still-animating-out. This hook does
// the open→closing transition during render (React's documented way to adjust
// state when a prop changes) and only uses an effect for the timer, which is
// asynchronous and therefore not the flagged pattern.

describe('useDialogMount', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('stays unmounted while closed', () => {
    const { result } = renderHook(() => useDialogMount(false))
    expect(result.current).toBe(false)
  })

  it('mounts immediately when opened', () => {
    const { result } = renderHook(() => useDialogMount(true))
    expect(result.current).toBe(true)
  })

  it('mounts on the same commit that opens it, with no blank frame', () => {
    const { result, rerender } = renderHook(({ open }) => useDialogMount(open), {
      initialProps: { open: false },
    })
    expect(result.current).toBe(false)
    rerender({ open: true })
    expect(result.current).toBe(true)
  })

  // The whole point: unmounting on the same tick would cut the exit animation.
  it('stays mounted through the exit window after closing', () => {
    const { result, rerender } = renderHook(({ open }) => useDialogMount(open), {
      initialProps: { open: true },
    })
    rerender({ open: false })
    expect(result.current).toBe(true)

    act(() => { vi.advanceTimersByTime(219) })
    expect(result.current).toBe(true)

    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current).toBe(false)
  })

  it('honours a custom exit duration', () => {
    const { result, rerender } = renderHook(({ open }) => useDialogMount(open, 500), {
      initialProps: { open: true },
    })
    rerender({ open: false })

    act(() => { vi.advanceTimersByTime(400) })
    expect(result.current).toBe(true)

    act(() => { vi.advanceTimersByTime(100) })
    expect(result.current).toBe(false)
  })

  // Reopening mid-animation must not leave a pending timer that unmounts the
  // dialog out from under the user a moment later.
  it('cancels the pending unmount when reopened during the exit window', () => {
    const { result, rerender } = renderHook(({ open }) => useDialogMount(open), {
      initialProps: { open: true },
    })
    rerender({ open: false })
    act(() => { vi.advanceTimersByTime(100) })
    rerender({ open: true })
    expect(result.current).toBe(true)

    act(() => { vi.advanceTimersByTime(500) })
    expect(result.current).toBe(true)
  })

  it('survives repeated open/close cycles', () => {
    const { result, rerender } = renderHook(({ open }) => useDialogMount(open), {
      initialProps: { open: false },
    })
    for (let i = 0; i < 3; i++) {
      rerender({ open: true })
      expect(result.current).toBe(true)
      rerender({ open: false })
      act(() => { vi.advanceTimersByTime(220) })
      expect(result.current).toBe(false)
    }
  })

  it('clears its timer on unmount', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    const { rerender, unmount } = renderHook(({ open }) => useDialogMount(open), {
      initialProps: { open: true },
    })
    rerender({ open: false })
    unmount()
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })
})
