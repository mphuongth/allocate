'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight } from 'lucide-react'

const BREADCRUMB_MAP: Record<string, { label: string; parent?: string }> = {
  '/': { label: 'Home' },
  '/dashboard': { label: 'Assets Dashboard', parent: '/' },
  '/planning': { label: 'Monthly Planning', parent: '/' },
  '/funds': { label: 'Fund Library', parent: '/' },
  '/settings': { label: 'Settings', parent: '/' },
}

interface Crumb {
  label: string
  href: string
  current: boolean
}

function buildCrumbs(pathname: string): Crumb[] {
  const entry = BREADCRUMB_MAP[pathname]
  if (!entry) return [{ label: 'Home', href: '/', current: false }, { label: pathname.slice(1), href: pathname, current: true }]

  const crumbs: Crumb[] = []
  if (entry.parent) {
    const parent = BREADCRUMB_MAP[entry.parent]
    if (parent) crumbs.push({ label: parent.label, href: entry.parent, current: false })
  }
  crumbs.push({ label: entry.label, href: pathname, current: true })
  return crumbs
}

export default function Breadcrumb() {
  const pathname = usePathname()
  const crumbs = buildCrumbs(pathname)

  return (
    <nav aria-label="Breadcrumb" className="hidden md:flex items-center gap-1">
      {crumbs.map((crumb, i) => (
        <span key={crumb.href} className="flex items-center gap-1">
          {i > 0 && <ChevronRight size={12} className="text-gray-400" />}
          {crumb.current ? (
            <span aria-current="page" className="text-xs text-gray-400 font-medium">
              {crumb.label}
            </span>
          ) : (
            <Link href={crumb.href} className="text-xs text-gray-600 hover:text-gray-900 transition-colors">
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
    <p className="text-sm font-medium text-gray-700 md:hidden px-4 py-2 border-b border-gray-100">
      {title}
    </p>
  )
}
