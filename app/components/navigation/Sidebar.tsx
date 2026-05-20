'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Calendar, TrendingUp, Settings } from 'lucide-react'
import { useNavigation } from './NavigationContext'
import { useTranslations } from 'next-intl'

// Real Cairn logo from cairn-icon-transparent.svg (stacked rounded rectangles)
function CairnMark({ size = 28 }: { size?: number }) {
  const h = Math.round(size * 0.85)
  return (
    <svg width={size} height={h} viewBox="110 180 283 240" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <rect x="111.872" y="359.936" width="280.064" height="57.856" rx="24.3" fill="#3B5A82"/>
      <rect x="152.064" y="293.888" width="220.16" height="50.176" rx="21.07" fill="#163A61"/>
      <rect x="163.84" y="233.984" width="167.936" height="44.032" rx="18.49" fill="#10B981"/>
      <rect x="208.128" y="181.76" width="103.936" height="35.84" rx="15.05" fill="#F8FAFC"/>
    </svg>
  )
}

// Mountains/landscape icon for the Overview nav item (matches design)
function MountainsIcon({ size = 18, strokeWidth = 1.75 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'block', flexShrink: 0 }}>
      <path d="M3 19h18l-6-9-3 4-2-3z" />
      <circle cx="8" cy="7" r="1.5" />
    </svg>
  )
}


function ChevronLeftIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

function ChevronRightIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

interface SidebarProps {
  email: string
  initials: string
  onNavClick?: () => void
  hideLogo?: boolean
}

export default function Sidebar({ email, initials, onNavClick, hideLogo = false }: SidebarProps) {
  const pathname = usePathname()
  const { sidebarCollapsed, setSidebarCollapsed, userName } = useNavigation()
  const t = useTranslations('nav')

  const NAV_ITEMS = [
    { label: t('dashboard'), href: '/dashboard', renderIcon: (active: boolean) => <MountainsIcon size={18} strokeWidth={active ? 2 : 1.6} /> },
    { label: t('planning'),  href: '/planning',  renderIcon: (active: boolean) => <Calendar  size={18} strokeWidth={active ? 2 : 1.6} /> },
    { label: t('funds'),     href: '/funds',     renderIcon: (active: boolean) => <TrendingUp size={18} strokeWidth={active ? 2 : 1.6} /> },
    { label: t('settings'),  href: '/settings',  renderIcon: (active: boolean) => <Settings   size={18} strokeWidth={active ? 2 : 1.6} /> },
  ]

  const w = sidebarCollapsed ? 64 : 220

  return (
    <aside data-testid="desktop-sidebar" style={{
      width: w, flexShrink: 0,
      background: 'var(--c-card)',
      borderRight: '1px solid var(--c-line)',
      display: 'flex', flexDirection: 'column',
      height: '100vh', position: 'sticky', top: 0,
      transition: 'width 200ms cubic-bezier(0.4,0,0.2,1)',
      overflow: 'hidden',
      zIndex: 40,
    }}>
      {/* Logo */}
      {!hideLogo && (
        <div style={{
          padding: sidebarCollapsed ? '20px 0' : '20px 16px 16px',
          display: 'flex', alignItems: 'center', gap: 10,
          borderBottom: '1px solid var(--c-line)',
          justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
          flexShrink: 0,
        }}>
          <CairnMark size={28} />
          {!sidebarCollapsed && (
            <span style={{
              fontFamily: 'inherit', fontSize: 17, fontWeight: 700,
              color: 'var(--c-navy)', letterSpacing: '-0.02em', whiteSpace: 'nowrap',
            }}>
              Cairn
            </span>
          )}
        </div>
      )}

      {/* Nav items */}
      <nav style={{
        flex: 1,
        padding: sidebarCollapsed ? '12px 0' : '12px 8px',
        display: 'flex', flexDirection: 'column', gap: 2,
      }}>
        {NAV_ITEMS.map(({ label, href, renderIcon }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavClick}
              aria-current={active ? 'page' : undefined}
              title={sidebarCollapsed ? label : undefined}
              style={{
                display: 'flex', alignItems: 'center',
                gap: 10,
                padding: sidebarCollapsed ? '11px 0' : '10px 12px',
                justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                borderRadius: sidebarCollapsed ? 0 : 8,
                background: active ? 'var(--c-navy-tint)' : 'transparent',
                color: active ? 'var(--c-navy)' : 'var(--c-muted)',
                textDecoration: 'none',
                fontSize: 13, fontWeight: active ? 600 : 400,
                transition: 'background 120ms, color 120ms',
                whiteSpace: 'nowrap',
                position: 'relative',
              }}
            >
              {active && (
                <span style={{
                  position: 'absolute', left: sidebarCollapsed ? 0 : -8, top: '50%',
                  transform: 'translateY(-50%)',
                  width: 3, height: 20, borderRadius: '0 2px 2px 0',
                  background: 'var(--c-navy)',
                }} />
              )}
              {renderIcon(active)}
              {!sidebarCollapsed && <span>{label}</span>}
            </Link>
          )
        })}
      </nav>

      {/* User card + collapse toggle */}
      <div style={{
        padding: sidebarCollapsed ? '12px 0' : '12px 8px',
        borderTop: '1px solid var(--c-line)',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        {/* User row */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: sidebarCollapsed ? '8px 0' : '8px 10px',
          justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
          borderRadius: 8,
        }}>
          <div style={{
            width: 30, height: 30, borderRadius: 15,
            background: 'var(--c-navy)',
            color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, flexShrink: 0,
            letterSpacing: '0.02em',
          }}>
            {initials}
          </div>
          {!sidebarCollapsed && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 12, fontWeight: 600, color: 'var(--c-ink)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {userName}
              </div>
              <div style={{
                fontSize: 10, color: 'var(--c-muted)', marginTop: 1,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {email}
              </div>
            </div>
          )}
        </div>

        {/* Collapse toggle */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          title={sidebarCollapsed ? 'Expand' : 'Collapse'}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 8, padding: '8px',
            border: 'none', background: 'transparent',
            color: 'var(--c-muted-2)', cursor: 'pointer',
            borderRadius: 6, fontFamily: 'inherit', fontSize: 11,
            transition: 'color 120ms',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--c-ink)' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--c-muted-2)' }}
        >
          {sidebarCollapsed ? <ChevronRightIcon size={14} /> : <ChevronLeftIcon size={14} />}
          {!sidebarCollapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  )
}
