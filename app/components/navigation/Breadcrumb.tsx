'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight } from 'lucide-react'

const BREADCRUMB_MAP: Record<string, { label: string }> = {
  '/dashboard': { label: 'Asset Overview' },
  '/planning': { label: 'Monthly Plan' },
  '/funds': { label: 'Fund Library' },
  '/settings': { label: 'Settings' },
}

interface Crumb {
  label: string
  href: string
  current: boolean
}

function buildCrumbs(pathname: string): Crumb[] {
  const entry = BREADCRUMB_MAP[pathname]
  if (!entry) return [{ label: pathname.slice(1), href: pathname, current: true }]
  return [{ label: entry.label, href: pathname, current: true }]
}

export default function Breadcrumb() {
  const pathname = usePathname()
  const crumbs = buildCrumbs(pathname)

  return (
    <nav aria-label="Breadcrumb" className="hidden md:flex items-center gap-1">
      {crumbs.map((crumb, i) => (
        <span key={crumb.href} className="flex items-center gap-1">
          {i > 0 && <ChevronRight size={12} className="text-gray-400 dark:text-gray-500" />}
          {crumb.current ? (
            <span aria-current="page" className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {crumb.label}
            </span>
          ) : (
            <Link href={crumb.href} className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors">
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  )
}

export function PageTitle() {
  const pathname = usePathname()
  const entry = BREADCRUMB_MAP[pathname]
  const title = entry?.label ?? pathname.slice(1)

  return (
    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 md:hidden px-4 py-2 border-b border-gray-100 dark:border-gray-700">
      {title}
    </p>
  )
}
