'use client'

import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'

const PATH_TO_NAV_KEY: Record<string, 'dashboard' | 'planning' | 'funds' | 'settings'> = {
  '/dashboard': 'dashboard',
  '/planning': 'planning',
  '/funds': 'funds',
  '/settings': 'settings',
}

export default function Breadcrumb() {
  const pathname = usePathname()
  const t = useTranslations('nav')
  const key = PATH_TO_NAV_KEY[pathname]
  const label = key ? t(key) : pathname.slice(1)

  return (
    <nav aria-label="Breadcrumb" className="hidden md:flex items-center gap-1">
      <span className="flex items-center gap-1">
        <span aria-current="page" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {label}
        </span>
      </span>
    </nav>
  )
}
