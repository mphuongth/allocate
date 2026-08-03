'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { WifiOff } from 'lucide-react'

const RECONNECTED_MS = 3000

// navigator.onLine is browser state this component doesn't own, which is exactly
// what useSyncExternalStore is for. Seeding it with setIsOnline(navigator.onLine)
// inside an effect was the set-state-in-effect shape (#537) — and it also meant
// the first paint always claimed "online", so a page loaded while offline showed
// nothing until an effect corrected it a frame later.
function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

const getSnapshot = () => navigator.onLine
// There is no navigator during SSR. "Online" matches what the markup assumed
// before, so hydration sees the same empty banner it always did.
const getServerSnapshot = () => true

export default function OfflineBanner() {
  const isOnline = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const [showReconnected, setShowReconnected] = useState(false)
  const [wasOffline, setWasOffline] = useState(false)

  // The reconnected notice depends on a *transition*, which a snapshot can't
  // express — so the previous value is tracked in state and compared during
  // render (React's documented way to adjust state when an input changes).
  const [prevOnline, setPrevOnline] = useState(isOnline)
  if (prevOnline !== isOnline) {
    setPrevOnline(isOnline)
    if (!isOnline) setWasOffline(true)
    // Only announce a reconnection that actually followed a drop.
    else if (wasOffline) setShowReconnected(true)
  }

  useEffect(() => {
    if (!showReconnected) return
    const t = setTimeout(() => setShowReconnected(false), RECONNECTED_MS)
    return () => clearTimeout(t)
  }, [showReconnected])

  if (isOnline && !showReconnected) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-0 inset-x-0 z-50 px-4 py-3 flex items-center justify-center gap-2 text-sm font-medium transition-colors ${
        isOnline ? 'bg-green-600 text-white' : 'bg-gray-900 dark:bg-gray-800 text-white'
      }`}
    >
      {isOnline ? (
        <span>Back online</span>
      ) : (
        <>
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>You&apos;re offline — viewing cached data</span>
        </>
      )}
    </div>
  )
}
