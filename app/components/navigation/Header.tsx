'use client'

import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import Breadcrumb from './Breadcrumb'
import UserMenu from './UserMenu'
import { useNavigation } from './NavigationContext'

interface HeaderProps {
  email: string
  initials: string
  onMobileMenuToggle: () => void
}

export default function Header({ email, initials, onMobileMenuToggle }: HeaderProps) {
  const { sidebarCollapsed, setSidebarCollapsed } = useNavigation()

  return (
    <header className="h-16 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex items-center px-4 gap-4 shrink-0">
      {/* Mobile hamburger */}
      <button
        onClick={onMobileMenuToggle}
        aria-label="Toggle navigation menu"
        className="lg:hidden p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-600 dark:text-gray-400"
      >
        <Menu size={20} />
      </button>

      {/* Tablet sidebar toggle */}
      <button
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        aria-label={sidebarCollapsed ? 'Mở rộng menu' : 'Thu gọn menu'}
        className="hidden md:flex lg:hidden p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-600 dark:text-gray-400"
      >
        {sidebarCollapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
      </button>

      {/* Mobile center logo */}
      <span className="lg:hidden flex-1 text-center text-brand font-bold text-lg tracking-tight">
        Allocate
      </span>

      {/* Breadcrumb (desktop/tablet only) */}
      <div className="hidden md:block flex-1">
        <Breadcrumb />
      </div>

      {/* User menu */}
      <div className="ml-auto">
        <UserMenu email={email} initials={initials} />
      </div>
    </header>
  )
}
