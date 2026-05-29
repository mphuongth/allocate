import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ServiceWorkerRegistration from '../ServiceWorkerRegistration'

describe('ServiceWorkerRegistration', () => {
  let listeners: Record<string, Array<() => void>>
  let register: ReturnType<typeof vi.fn>
  let update: ReturnType<typeof vi.fn>
  let reload: ReturnType<typeof vi.fn>

  function setupServiceWorker({ controller }: { controller: object | null }) {
    listeners = {}
    update = vi.fn()
    register = vi.fn().mockResolvedValue({ update })
    const sw = {
      controller,
      register,
      addEventListener: (type: string, cb: () => void) => {
        ;(listeners[type] ??= []).push(cb)
      },
      removeEventListener: (type: string, cb: () => void) => {
        listeners[type] = (listeners[type] ?? []).filter((l) => l !== cb)
      },
    }
    Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true })
  }

  function fireControllerChange() {
    ;(listeners['controllerchange'] ?? []).forEach((cb) => cb())
  }

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production')
    reload = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { href: 'http://localhost/', reload },
      configurable: true,
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('registers the service worker in production', () => {
    setupServiceWorker({ controller: null })
    render(<ServiceWorkerRegistration />)
    expect(register).toHaveBeenCalledWith('/sw.js')
  })

  it('reloads once when a new worker takes control after an update', () => {
    // A controller already exists → this page is controlled by an old worker,
    // so a controllerchange means a new version has activated.
    setupServiceWorker({ controller: {} })
    render(<ServiceWorkerRegistration />)
    fireControllerChange()
    fireControllerChange()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not reload on the very first install (no prior controller)', () => {
    setupServiceWorker({ controller: null })
    render(<ServiceWorkerRegistration />)
    fireControllerChange()
    expect(reload).not.toHaveBeenCalled()
  })
})
