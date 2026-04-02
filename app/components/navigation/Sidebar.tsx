'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart3, Calendar, BookOpen, Settings } from 'lucide-react'
import { useNavigation } from './NavigationContext'
import { useTranslations } from 'next-intl'
import LanguageSwitcher from '../LanguageSwitcher'

interface SidebarProps {
  email: string
  initials: string
  onNavClick?: () => void
}

export default function Sidebar({ email, initials, onNavClick }: SidebarProps) {
  const pathname = usePathname()
  const { sidebarCollapsed } = useNavigation()
  const t = useTranslations('nav')

  const NAV_ITEMS = [
    { label: t('dashboard'), href: '/dashboard', icon: BarChart3 },
    { label: t('planning'), href: '/planning', icon: Calendar },
    { label: t('funds'), href: '/funds', icon: BookOpen },
    { label: t('settings'), href: '/settings', icon: Settings },
  ]

  return (
    <nav
      className={`flex flex-col h-full bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 transition-all duration-200 ${
        sidebarCollapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Logo */}
      <div className={`flex items-center h-16 px-6 border-b border-gray-100 dark:border-gray-700 ${sidebarCollapsed ? 'justify-center px-0' : ''}`}>
        {sidebarCollapsed ? (
          <span className="text-violet-600 font-semibold text-lg">A</span>
        ) : (
          <span className="text-violet-600 font-semibold text-xl">Allocate</span>
        )}
      </div>

      {/* Nav items */}
      <ul className="flex-1 p-4 space-y-1">
        {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
          const active = pathname === href
          return (
            <li key={href}>
              <Link
                href={href}
                onClick={onNavClick}
                aria-current={active ? 'page' : undefined}
                title={sidebarCollapsed ? label : undefined}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm font-medium ${
                  active
                    ? 'bg-violet-50 dark:bg-brand/20 text-violet-600 dark:text-violet-300'
                    : 'text-gray-700 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100'
                } ${sidebarCollapsed ? 'justify-center' : ''}`}
              >
                <Icon size={20} className="shrink-0" />
                {!sidebarCollapsed && <span>{label}</span>}
              </Link>
            </li>
          )
        })}
      </ul>

      {/* Profile + Language switcher */}
      {!sidebarCollapsed && (
        <div className="border-t border-gray-100 dark:border-gray-700 p-4">
          <div className="flex items-center gap-3 rounded-lg bg-gray-50 dark:bg-gray-800 p-3">
            <div className="w-8 h-8 rounded-full bg-violet-600 flex items-center justify-center text-white text-xs font-semibold shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{email}</p>
            </div>
            <LanguageSwitcher />
          </div>
        </div>
      )}
    </nav>
  )
}
