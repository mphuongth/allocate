'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'

export function LandingLangToggle() {
  const locale = useLocale()
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function switchLocale(next: string) {
    document.cookie = `locale=${next};path=/;max-age=31536000;SameSite=Lax`
    startTransition(() => router.refresh())
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center',
      background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)',
      borderRadius: 8, overflow: 'hidden', marginRight: 4,
      opacity: isPending ? 0.6 : 1, transition: 'opacity 150ms',
    }}>
      {(['en', 'vi'] as const).map(lang => (
        <button key={lang} onClick={() => switchLocale(lang)} style={{
          padding: '5px 11px', fontSize: 12, fontWeight: 600,
          color: locale === lang ? '#fff' : 'rgba(255,255,255,0.5)',
          background: locale === lang ? 'rgba(255,255,255,0.16)' : 'transparent',
          border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          transition: 'background 120ms, color 120ms', letterSpacing: '0.03em',
          textTransform: 'uppercase',
        }}>
          {lang}
        </button>
      ))}
    </div>
  )
}
