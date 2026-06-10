'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { FullPageLoader } from './FullPageLoader'

// Keep in sync with the boot-fade-out animation duration in globals.css (320ms);
// we unmount a touch later so the fade has fully played.
const FADE_MS = 360

/**
 * First-app-load splash (issue #235). Renders a full-screen brand loader over
 * the app shell, then fades out shortly after hydration.
 *
 * It lives in the persistent authenticated layout, so it shows once per cold
 * boot and never on client-side tab navigation — keeping the design's split
 * between "first app load" (full screen) and "screen first paint" (skeleton).
 */
export function AppBootSplash() {
  const t = useTranslations('common')
  const [hiding, setHiding] = useState(false)
  const [gone, setGone] = useState(false)

  // Defer a tick past hydration so the SSR splash is painted, then start the
  // CSS fade. (setState lives in the timer callback, not the effect body.)
  useEffect(() => {
    const id = setTimeout(() => setHiding(true), 0)
    return () => clearTimeout(id)
  }, [])

  // Unmount once the fade has played.
  useEffect(() => {
    if (!hiding) return
    const id = setTimeout(() => setGone(true), FADE_MS)
    return () => clearTimeout(id)
  }, [hiding])

  if (gone) return null

  return (
    <div className={`app-boot-splash${hiding ? ' hiding' : ''}`}>
      <FullPageLoader title={t('loadingPortfolio')} subtitle={t('syncingBalances')} />
    </div>
  )
}

export default AppBootSplash
