import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useProfileEditor } from '../useProfileEditor'
import { SAVE_FLASH_MS } from '../settingsOptions'

describe('useProfileEditor', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  function setup(saveProfile: (name: string) => Promise<boolean>, onDone = vi.fn()) {
    const view = renderHook(() => useProfileEditor('Minh Tran', saveProfile, onDone))
    return { ...view, onDone }
  }

  it('opens on the current display name', () => {
    const { result } = setup(vi.fn())
    expect(result.current.name).toBe('Minh Tran')
    expect(result.current.saved).toBe(false)
  })

  it('edits the draft without touching the account', async () => {
    const saveProfile = vi.fn()
    const { result } = setup(saveProfile)
    act(() => result.current.setName('Minh'))
    expect(result.current.name).toBe('Minh')
    expect(saveProfile).not.toHaveBeenCalled()
  })

  it('persists the draft, flashes Saved, then closes', async () => {
    const saveProfile = vi.fn().mockResolvedValue(true)
    const { result, onDone } = setup(saveProfile)

    act(() => result.current.setName('Minh'))
    await act(async () => { await result.current.save() })

    expect(saveProfile).toHaveBeenCalledWith('Minh')
    expect(result.current.saved).toBe(true)
    expect(onDone).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(SAVE_FLASH_MS) })
    expect(result.current.saved).toBe(false)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  // A failed write surfaces its own toast from saveProfile. Flashing "Saved" and
  // closing over it would tell the user their name was stored when it wasn't.
  it('neither flashes nor closes when the write fails', async () => {
    const { result, onDone } = setup(vi.fn().mockResolvedValue(false))

    await act(async () => { await result.current.save() })

    expect(result.current.saved).toBe(false)
    act(() => { vi.advanceTimersByTime(SAVE_FLASH_MS * 2) })
    expect(onDone).not.toHaveBeenCalled()
  })

  it('reopens on the latest saved name after an edit is abandoned', () => {
    const { result } = setup(vi.fn())
    act(() => result.current.setName('typed but never saved'))
    act(() => result.current.reset())
    expect(result.current.name).toBe('Minh Tran')
    expect(result.current.saved).toBe(false)
  })

  // The desktop view used a bare setTimeout here and leaked a setState past
  // unmount (#570). The shared editor schedules through useManagedTimeout.
  it('does not fire the flash reset after unmount', async () => {
    const onDone = vi.fn()
    const { result, unmount } = renderHook(() =>
      useProfileEditor('Minh Tran', () => Promise.resolve(true), onDone))

    await act(async () => { await result.current.save() })
    unmount()
    act(() => { vi.advanceTimersByTime(SAVE_FLASH_MS * 2) })

    expect(onDone).not.toHaveBeenCalled()
  })

  it('tracks a display name that changes underneath it', async () => {
    const { result, rerender } = renderHook(
      ({ name }) => useProfileEditor(name, () => Promise.resolve(true), vi.fn()),
      { initialProps: { name: 'Minh Tran' } },
    )
    rerender({ name: 'Minh T' })
    act(() => result.current.reset())
    expect(result.current.name).toBe('Minh T')
  })
})
