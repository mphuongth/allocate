'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
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

export function PageTitle() {
  const pathname = usePathname()
  const t = useTranslations('nav')
  const key = PATH_TO_NAV_KEY[pathname]
  const title = key ? t(key) : pathname.slice(1)

  return (
    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 md:hidden px-4 py-2 border-b border-gray-100 dark:border-gray-700">
      {title}
    </p>
  )
}
