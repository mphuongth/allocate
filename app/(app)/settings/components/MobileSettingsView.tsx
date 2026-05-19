'use client'

import { useState, useEffect, useTransition } from 'react'
import { useLocale } from 'next-intl'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { useTheme, type ThemeChoice } from '@/app/components/ThemeProvider'
import {
  Globe, Sun, Wallet, Download, RefreshCw,
  TrendingUp, CircleDollarSign, LogOut, ChevronRight, Check,
} from 'lucide-react'
import { toast } from 'sonner'
import { useNavigation } from '@/app/components/navigation/NavigationContext'
import DownloadReportSheet from '@/app/assets/components/DownloadReportSheet'
import type { DashboardData } from '@/app/assets/DashboardClient'

interface Props {
  email: string
  initials: string
  displayName: string
}

// ─── Bottom sheet wrapper ──────────────────────────────────────────────────────

function BottomSheet({ open, onClose, title, children }: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
    } else {
      const t = setTimeout(() => setMounted(false), 220)
      return () => clearTimeout(t)
    }
  }, [open])

  if (!mounted) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15,23,42,0.2)',
        zIndex: 150,
        pointerEvents: open ? 'auto' : 'none',
      }}
      onClick={onClose}
    >
      <div
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'var(--c-card)',
          borderRadius: '16px 16px 0 0',
          padding: '0 0 env(safe-area-inset-bottom,0)',
          animation: open
            ? 'slide-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1)'
            : 'slide-down 180ms ease forwards',
          maxHeight: '85dvh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 36, height: 4, background: 'var(--c-line-strong)', borderRadius: 999, margin: '10px auto 0' }} />
        <div style={{ padding: '14px 16px 0', borderBottom: '1px solid var(--c-line)', marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-ink)', paddingBottom: 14 }}>{title}</div>
        </div>
        <div style={{ padding: '0 16px 28px' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

// ─── Profile sheet ─────────────────────────────────────────────────────────────

function ProfileSheet({ open, onClose, onSave, displayName, email }: {
  open: boolean
  onClose: () => void
  onSave: (name: string) => void
  displayName: string
  email: string
}) {
  const [name, setName] = useState(displayName)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (open) { setName(displayName); setSaved(false) }
  }, [open, displayName])

  function handleSave() {
    setSaved(true)
    onSave(name)
    setTimeout(() => { setSaved(false); onClose() }, 1200)
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Profile">
      {saved ? (
        <div style={{ padding: '28px 0', textAlign: 'center' }}>
          <div style={{
            width: 52, height: 52, borderRadius: 26,
            background: 'var(--c-pos-tint)', color: 'var(--c-pos)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px',
          }}>
            <Check size={26} strokeWidth={2.5} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Saved</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-muted)', marginBottom: 6 }}>
              Full name
            </div>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px', fontSize: 13,
                background: 'var(--c-card-2)', border: '1px solid var(--c-line)',
                borderRadius: 10, color: 'var(--c-ink)', fontFamily: 'inherit',
                outline: 'none',
              }}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-muted)', marginBottom: 6 }}>
              Email
            </div>
            <input
              type="email"
              defaultValue={email}
              readOnly
              style={{
                width: '100%', padding: '10px 12px', fontSize: 13,
                background: 'var(--c-card-2)', border: '1px solid var(--c-line)',
                borderRadius: 10, color: 'var(--c-muted)', fontFamily: 'inherit',
                outline: 'none',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              onClick={onClose}
              aria-label="cancel"
              style={{
                flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 500,
                background: 'var(--c-card)', border: '1px solid var(--c-line)',
                borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
                color: 'var(--c-ink)',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              style={{
                flex: 2, padding: '10px 0', fontSize: 13, fontWeight: 600,
                background: 'var(--c-btn-primary)', border: 'none',
                borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
                color: '#fff',
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  )
}

// ─── Appearance sheet ──────────────────────────────────────────────────────────

function AppearanceSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme: currentTheme, setTheme } = useTheme()

  const storedChoice = (): ThemeChoice => {
    if (typeof localStorage === 'undefined') return currentTheme
    const v = localStorage.getItem('theme')
    return (v === 'light' || v === 'dark') ? v : 'system'
  }

  const [selected, setSelected] = useState<ThemeChoice>(currentTheme)

  useEffect(() => {
    if (open) setSelected(storedChoice())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const options: { v: ThemeChoice; icon: React.ReactNode; label: string }[] = [
    { v: 'light',  icon: <Sun size={18} />,                               label: 'Light'  },
    { v: 'dark',   icon: <span style={{ fontSize: 16 }}>🌙</span>,        label: 'Dark'   },
    { v: 'system', icon: <span style={{ fontSize: 16 }}>⚙️</span>,         label: 'System' },
  ]

  function handleApply() {
    setTheme(selected)
    onClose()
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Appearance">
      <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
        {options.map(opt => (
          <button
            key={opt.v}
            onClick={() => setSelected(opt.v)}
            style={{
              width: '100%', textAlign: 'left', padding: '14px 16px',
              background: selected === opt.v ? 'var(--c-navy-tint)' : 'var(--c-card)',
              border: `1.5px solid ${selected === opt.v ? 'var(--c-navy)' : 'var(--c-line)'}`,
              borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 12, transition: 'all 120ms',
            }}
          >
            <span style={{ color: selected === opt.v ? 'var(--c-navy)' : 'var(--c-muted)' }}>{opt.icon}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: selected === opt.v ? 'var(--c-navy)' : 'var(--c-ink)', flex: 1 }}>
              {opt.label}
            </span>
            {selected === opt.v && (
              <div style={{ width: 20, height: 20, borderRadius: 10, background: 'var(--c-btn-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Check size={12} strokeWidth={2.5} color="#fff" />
              </div>
            )}
          </button>
        ))}
      </div>
      <button
        onClick={handleApply}
        aria-label="apply"
        style={{
          width: '100%', padding: '11px 0', fontSize: 13, fontWeight: 600,
          background: 'var(--c-btn-primary)', border: 'none',
          borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
          color: '#fff',
        }}
      >
        Apply
      </button>
    </BottomSheet>
  )
}

// ─── Currency sheet ────────────────────────────────────────────────────────────

function CurrencySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [currency, setCurrency] = useState('VND')

  const currencies = [
    { v: 'VND', label: 'Vietnamese Dong', symbol: '₫' },
    { v: 'USD', label: 'US Dollar',       symbol: '$' },
    { v: 'EUR', label: 'Euro',            symbol: '€' },
  ]

  return (
    <BottomSheet open={open} onClose={onClose} title="Currency">
      <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
        {currencies.map(c => (
          <button
            key={c.v}
            onClick={() => setCurrency(c.v)}
            style={{
              width: '100%', textAlign: 'left', padding: '14px 16px',
              background: currency === c.v ? 'var(--c-navy-tint)' : 'var(--c-card)',
              border: `1.5px solid ${currency === c.v ? 'var(--c-navy)' : 'var(--c-line)'}`,
              borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 12, transition: 'all 120ms',
            }}
          >
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              background: currency === c.v ? 'var(--c-btn-primary)' : 'var(--c-card-2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: currency === c.v ? '#fff' : 'var(--c-muted)' }}>
                {c.symbol}
              </span>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: currency === c.v ? 'var(--c-navy)' : 'var(--c-ink)' }}>
                {c.v}
              </div>
              <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 1 }}>{c.label}</div>
            </div>
            {currency === c.v && (
              <div style={{ width: 20, height: 20, borderRadius: 10, background: 'var(--c-btn-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Check size={12} strokeWidth={2.5} color="#fff" />
              </div>
            )}
          </button>
        ))}
      </div>
      <button
        onClick={onClose}
        aria-label="apply"
        style={{
          width: '100%', padding: '11px 0', fontSize: 13, fontWeight: 600,
          background: 'var(--c-btn-primary)', border: 'none',
          borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
          color: '#fff',
        }}
      >
        Apply
      </button>
    </BottomSheet>
  )
}

// ─── Settings row ──────────────────────────────────────────────────────────────

function SettingsRow({ icon, label, value, onClick, last = false }: {
  icon: React.ReactNode
  label: string
  value?: string
  onClick: () => void
  last?: boolean
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      style={{
        width: '100%', textAlign: 'left', padding: '12px 14px',
        background: 'transparent', border: 'none',
        borderBottom: last ? 'none' : '1px solid var(--c-line)',
        display: 'flex', alignItems: 'center', gap: 12,
        cursor: 'pointer', fontFamily: 'inherit', transition: 'background 120ms',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--c-card-2)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <div style={{
        width: 32, height: 32, borderRadius: 8, background: 'var(--c-card-2)',
        color: 'var(--c-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        {icon}
      </div>
      <span style={{ flex: 1, fontSize: 13, color: 'var(--c-ink)', fontWeight: 500 }}>{label}</span>
      {value && <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{value}</span>}
      <ChevronRight size={14} color="var(--c-muted)" />
    </button>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function MobileSettingsView({ email, initials, displayName }: Props) {
  const locale = useLocale()
  const router = useRouter()
  const [, startTransition] = useTransition()
  const { setMobileTopBar } = useNavigation()

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [localDisplayName, setLocalDisplayName] = useState(displayName)

  const localInitials = localDisplayName
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('') || initials

  const [showProfile, setShowProfile] = useState(false)
  const [showAppearance, setShowAppearance] = useState(false)
  const [showCurrency, setShowCurrency] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const [overviewCache, setOverviewCache] = useState<DashboardData | null>(null)

  const [syncing, setSyncing] = useState(false)
  const [syncDone, setSyncDone] = useState(false)
  const [lastSync, setLastSync] = useState('2h')

  const isVI = locale === 'vi'

  useEffect(() => {
    setMobileTopBar({
      title: isVI ? 'Tùy chọn' : 'Preferences',
      subtitle: isVI ? 'Cài đặt' : 'Settings',
    })
    return () => setMobileTopBar({ title: '' })
  }, [isVI, setMobileTopBar])

  function switchLocale(next: string) {
    document.cookie = `locale=${next};path=/;max-age=31536000;SameSite=Lax`
    startTransition(() => router.refresh())
  }

  async function handleSync() {
    setSyncing(true)
    setSyncDone(false)
    try {
      await Promise.all([
        fetch('/api/cron/refresh-navs'),
        fetch('/api/cron/refresh-gold'),
      ])
    } catch {
      // ignore
    }
    setSyncing(false)
    setSyncDone(true)
    setLastSync(isVI ? 'Vừa xong' : 'Just now')
    setTimeout(() => setSyncDone(false), 3000)
  }

  function handleOpenReport() {
    setShowReport(true)
    fetch('/api/v1/dashboard/overview', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then((json: DashboardData | null) => { if (json) setOverviewCache(json) })
      .catch(() => {})
  }

  async function handleExportReport() {
    let data = overviewCache
    if (!data) {
      const res = await fetch('/api/v1/dashboard/overview', { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed to load portfolio data')
      data = await res.json()
    }
    const { downloadPortfolioPDF } = await import('@/lib/generateReport')
    await downloadPortfolioPDF(data!, locale)
  }

  async function handleSignOut() {
    const { error } = await supabase.auth.signOut()
    if (error) {
      toast.error(isVI ? 'Đăng xuất thất bại' : 'Sign out failed')
    } else {
      Object.keys(localStorage)
        .filter(k =>
          k.startsWith('dashboardOverviewCache') ||
          k.startsWith('planningCache_') ||
          k.startsWith('savingsGoalsCache') ||
          k.startsWith('fixedExpensesCache') ||
          k.startsWith('insuranceMembersCache') ||
          k.startsWith('fundLibraryCache')
        )
        .forEach(k => localStorage.removeItem(k))
      router.push('/auth/login')
    }
  }

  const localeLabel = isVI ? 'Tiếng Việt' : 'English'
  const appearanceLabel = isVI ? 'Sáng' : 'Light'

  return (
    <>
      <div className="md:hidden -mx-4 -mt-4" style={{ background: 'var(--c-canvas)', minHeight: '100%' }}>
      <div style={{ padding: '4px 16px 80px' }}>

        {/* Profile card */}
        <button
          onClick={() => setShowProfile(true)}
          aria-label="profile"
          style={{
            width: '100%', padding: 18, display: 'flex', alignItems: 'center', gap: 14,
            textAlign: 'left', background: 'var(--c-card)', border: '1px solid var(--c-line)',
            borderRadius: 16, cursor: 'pointer', fontFamily: 'inherit',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          {/* Avatar */}
          <div style={{
            width: 48, height: 48, borderRadius: 24,
            background: 'var(--c-btn-primary)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontWeight: 700, flexShrink: 0,
          }}>
            {localInitials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-ink)' }}>{localDisplayName}</div>
            <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 2 }}>{email}</div>
          </div>
          <ChevronRight size={16} color="var(--c-muted)" />
        </button>

        {/* Preferences section */}
        <section style={{ marginTop: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-muted)', marginBottom: 8, paddingLeft: 4 }}>
            {isVI ? 'Tùy chỉnh' : 'Preferences'}
          </div>
          <div style={{ background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
            <SettingsRow
              icon={<Globe size={16} />}
              label={isVI ? 'Ngôn ngữ' : 'Language'}
              value={localeLabel}
              onClick={() => switchLocale(isVI ? 'en' : 'vi')}
            />
            <SettingsRow
              icon={<Sun size={16} />}
              label={isVI ? 'Giao diện' : 'Appearance'}
              value={appearanceLabel}
              onClick={() => setShowAppearance(true)}
            />
            <SettingsRow
              icon={<Wallet size={16} />}
              label={isVI ? 'Tiền tệ' : 'Currency'}
              value="VND"
              onClick={() => setShowCurrency(true)}
              last
            />
          </div>
        </section>

        {/* Data section */}
        <section style={{ marginTop: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-muted)', marginBottom: 8, paddingLeft: 4 }}>
            {isVI ? 'Dữ liệu' : 'Data'}
          </div>
          <div style={{ background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
            <SettingsRow
              icon={<Download size={16} />}
              label={isVI ? 'Xuất dữ liệu' : 'Export data'}
              onClick={handleOpenReport}
              last
            />
          </div>
        </section>

        {/* Price sync section */}
        <section style={{ marginTop: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-muted)', marginBottom: 8, paddingLeft: 4 }}>
            {isVI ? 'Đồng bộ giá' : 'Price sync'}
          </div>
          <div style={{ background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 16, padding: 16, boxShadow: 'var(--shadow-card)' }}>
            {/* Sync header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8, background: 'var(--c-navy-tint)', color: 'var(--c-navy)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <RefreshCw size={16} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)' }}>
                  {isVI ? 'Đồng bộ tất cả giá' : 'Sync all prices'}
                </div>
                <div style={{ fontSize: 11, color: syncDone ? 'var(--c-pos)' : 'var(--c-muted)', marginTop: 2, transition: 'color 200ms' }}>
                  {syncing
                    ? (isVI ? 'Đang tải...' : 'Updating…')
                    : syncDone
                    ? (isVI ? '✓ Đã cập nhật' : '✓ Updated')
                    : (isVI ? `Lần cuối: ${lastSync} trước` : `Last synced: ${lastSync} ago`)}
                </div>
              </div>
              <button
                onClick={handleSync}
                disabled={syncing}
                aria-label="sync now"
                style={{
                  padding: '7px 14px', fontSize: 12, fontWeight: 600,
                  background: 'var(--c-btn-primary)', border: 'none', borderRadius: 8,
                  color: '#fff', cursor: syncing ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', opacity: syncing ? 0.6 : 1,
                  transition: 'opacity 150ms',
                }}
              >
                {syncing
                  ? (isVI ? 'Đang...' : 'Syncing…')
                  : (isVI ? 'Đồng bộ' : 'Sync now')}
              </button>
            </div>

            {/* Source rows */}
            <div style={{ display: 'grid', gap: 8, padding: '12px 0 0', borderTop: '1px solid var(--c-line)' }}>
              {[
                {
                  icon: <TrendingUp size={14} />,
                  color: '#2563eb',
                  label: isVI ? 'NAV quỹ đầu tư' : 'Fund NAV',
                  note: isVI ? 'Tự động đồng bộ lúc 18:00 mỗi ngày' : 'Auto-syncs daily at 6:00 PM',
                },
                {
                  icon: <CircleDollarSign size={14} />,
                  color: '#d97706',
                  label: isVI ? 'Giá vàng DOJI' : 'Gold price (DOJI)',
                  note: isVI ? 'Tự động đồng bộ lúc 09:00 mỗi ngày' : 'Auto-syncs daily at 9:00 AM',
                },
              ].map((row, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 7, background: 'var(--c-card-2)',
                    color: row.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    {row.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-ink)' }}>{row.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 1 }}>{row.note}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Sign out */}
        <button
          onClick={handleSignOut}
          aria-label="sign out"
          style={{
            width: '100%', marginTop: 22, padding: '13px 14px',
            background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 10,
            color: 'var(--c-neg)', fontSize: 13, fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            cursor: 'pointer', fontFamily: 'inherit', boxShadow: 'var(--shadow-card)',
          }}
        >
          <LogOut size={16} />
          {isVI ? 'Đăng xuất' : 'Sign out'}
        </button>

        {/* Version */}
        <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--c-muted)', marginTop: 16 }}>
          Cairn v0.4 · {isVI ? 'Bản nội bộ' : 'Internal preview'}
        </p>
      </div>
      </div>

      {/* Sheets */}
      <ProfileSheet
        open={showProfile}
        onClose={() => setShowProfile(false)}
        onSave={async (name) => {
          setLocalDisplayName(name)
          await supabase.auth.updateUser({ data: { display_name: name } })
        }}
        displayName={localDisplayName}
        email={email}
      />
      <AppearanceSheet
        open={showAppearance}
        onClose={() => setShowAppearance(false)}
      />
      <CurrencySheet
        open={showCurrency}
        onClose={() => setShowCurrency(false)}
      />
      <DownloadReportSheet
        open={showReport}
        onClose={() => setShowReport(false)}
        data={overviewCache ? {
          netWorth: overviewCache.netWorth.netWorth,
          currentValue: overviewCache.netWorth.currentValue,
          totalPL: overviewCache.netWorth.overallProfitLoss,
          goalCount: overviewCache.goals.length,
        } : null}
        onExport={handleExportReport}
      />
    </>
  )
}
