'use client'

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import Breadcrumb from './Breadcrumb'
import UserMenu from './UserMenu'
import { useNavigation } from './NavigationContext'
import ThemeToggleButton from '../ThemeToggleButton'
import { useTranslations } from 'next-intl'

export default function Header() {
  const { sidebarCollapsed, setSidebarCollapsed } = useNavigation()
  const tc = useTranslations('common')

  return (
    <header className="h-14 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-700 flex items-center px-4 md:px-6 gap-3 shrink-0">
      {/* Tablet sidebar collapse toggle */}
      <button
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        aria-label={sidebarCollapsed ? tc('expandMenu') : tc('collapseMenu')}
        className="hidden md:flex lg:hidden p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-500 dark:text-gray-400"
      >
        {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
      </button>

      {/* Mobile logo (no sidebar visible) */}
      <div className="md:hidden flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/cairn-icon.svg"
          alt="Cairn logo"
          width={26}
          height={26}
          className="h-6.5 w-6.5 rounded-md"
        />
        <span className="text-brand font-bold text-base tracking-tight">Cairn</span>
      </div>

      {/* Breadcrumb (tablet + desktop) */}
      <div className="hidden md:block flex-1">
        <Breadcrumb />
      </div>

      <div className="flex-1 md:hidden" />

      {/* Theme toggle */}
      <ThemeToggleButton />

      {/* User menu */}
      <UserMenu />
    </header>
  )
}
