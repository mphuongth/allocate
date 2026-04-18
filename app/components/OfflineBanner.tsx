'use client'

import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'

export default function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(true)
  const [showReconnected, setShowReconnected] = useState(false)
  const [wasOffline, setWasOffline] = useState(false)

  useEffect(() => {
    setIsOnline(navigator.onLine)

    const handleOffline = () => {
      setIsOnline(false)
      setWasOffline(true)
    }

    const handleOnline = () => {
      setIsOnline(true)
      if (wasOffline) {
        setShowReconnected(true)
        const t = setTimeout(() => setShowReconnected(false), 3000)
        return () => clearTimeout(t)
      }
    }

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [wasOffline])

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
