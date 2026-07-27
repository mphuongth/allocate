'use client'

import { useState, useEffect, useMemo, useRef, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { useTheme, type ThemeChoice } from '@/app/components/ThemeProvider'
import { useDialogA11y } from '@/app/(app)/planning/components/useDialogA11y'
import {
  Globe, Sun, Moon, Settings, Download, RefreshCw,
  TrendingUp, Coins, LogOut, ChevronRight, Check,
} from 'lucide-react'
import { toast } from 'sonner'
import { useNavigation } from '@/app/components/navigation/NavigationContext'
import DownloadReportSheet from '@/app/assets/components/DownloadReportSheet'
import type { DashboardData } from '@/app/assets/DashboardClient'
import { clearAppCaches, setLocaleCookie, refreshPrices, fetchOverview, exportPortfolioReport, fetchLastSync, formatLastSync } from '../settingsShared'

interface Props {
  email: string
  initials: string
  displayName: string
}

// How long the "Saved" success flash stays up before the sheet/modal closes.
// Kept in sync with DesktopSettingsView so both views feel identical.
const SAVE_FLASH_MS = 1400

// Read the persisted theme *choice* (not the resolved theme) from localStorage,
// falling back to the resolved theme during SSR. 'system' is the absence of a
// stored value. Mirrors DesktopSettingsView's storedTheme().
function readThemeChoice(fallback: ThemeChoice): ThemeChoice {
  if (typeof localStorage === 'undefined') return fallback
  const v = localStorage.getItem('theme')
  return (v === 'light' || v === 'dark') ? v : 'system'
}

// ─── Bottom sheet wrapper ──────────────────────────────────────────────────────

function BottomSheet({ open, onClose, title, dismissOnBackdrop = true, children }: {
  open: boolean
  onClose: () => void
  title: string
  dismissOnBackdrop?: boolean
  children: React.ReactNode
}) {
  const [mounted, setMounted] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  // Esc-to-close, focus-trap and focus-restore — same hook the Plan page sheets use.
  useDialogA11y(dialogRef, open && mounted, onClose)

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
      // Form sheets (the profile editor) opt out of backdrop dismissal so a
      // stray tap doesn't discard a half-typed name. Esc + Cancel still close.
      onClick={dismissOnBackdrop ? onClose : undefined}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
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
          outline: 'none',
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
  onSave: (name: string) => Promise<boolean>
  displayName: string
  email: string
}) {
  const t = useTranslations('settings')
  const [name, setName] = useState(displayName)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (open) { setName(displayName); setSaved(false) }
  }, [open, displayName])

  async function handleSave() {
    // Only flash "Saved" and close once the persist actually succeeded — a
    // failed update surfaces a toast (from onSave) and keeps the form open.
    const ok = await onSave(name)
    if (!ok) return
    setSaved(true)
    setTimeout(() => { setSaved(false); onClose() }, SAVE_FLASH_MS)
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={t('profileModalTitle')} dismissOnBackdrop={false}>
      {saved ? (
        <div style={{ padding: '28px 0', textAlign: 'center' }}>
          <div style={{
            width: 52, height: 52, borderRadius: 26,
            background: 'var(--c-pos-tint)', color: 'var(--c-pos)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px',
          }}>
            <Check size={26} strokeWidth={2.5} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{t('saved')}</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-muted)', marginBottom: 6 }}>
              {t('fullName')}
            </div>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              style={{
                width: '100%', padding: '10px 12px', fontSize: 16,
                background: 'var(--c-card-2)', border: '1px solid var(--c-line)',
                borderRadius: 10, color: 'var(--c-ink)', fontFamily: 'inherit',
                outline: 'none',
              }}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-muted)', marginBottom: 6 }}>
              {t('email')}
            </div>
            <input
              type="email"
              defaultValue={email}
              readOnly
              style={{
                width: '100%', padding: '10px 12px', fontSize: 16,
                background: 'var(--c-card-2)', border: '1px solid var(--c-line)',
                borderRadius: 10, color: 'var(--c-muted)', fontFamily: 'inherit',
                outline: 'none',
              }}
            />
            <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 6 }}>
              {t('emailReadonlyHint')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              onClick={onClose}
              aria-label={t('cancel')}
              style={{
                flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 500,
                minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--c-card)', border: '1px solid var(--c-line)',
                borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
                color: 'var(--c-ink)',
              }}
            >
              {t('cancel')}
            </button>
            <button
              onClick={handleSave}
              style={{
                flex: 2, padding: '10px 0', fontSize: 13, fontWeight: 600,
                minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--c-btn-primary)', border: 'none',
                borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
                color: '#fff',
              }}
            >
              {t('save')}
            </button>
          </div>
        </div>
      )}
    </BottomSheet>
  )
}

// ─── Appearance sheet ──────────────────────────────────────────────────────────

function AppearanceSheet({ open, onClose, onApply }: {
  open: boolean
  onClose: () => void
  onApply: (choice: ThemeChoice) => void
}) {
  const t = useTranslations('settings')
  const { theme: currentTheme, setTheme } = useTheme()

  const [selected, setSelected] = useState<ThemeChoice>(currentTheme)

  useEffect(() => {
    if (open) setSelected(readThemeChoice(currentTheme))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const options: { v: ThemeChoice; icon: React.ReactNode; label: string }[] = [
    { v: 'light',  icon: <Sun size={18} />,      label: t('appearanceLight')  },
    { v: 'dark',   icon: <Moon size={18} />,     label: t('appearanceDark')   },
    { v: 'system', icon: <Settings size={18} />, label: t('appearanceSystem') },
  ]

  function handleApply() {
    setTheme(selected)
    onApply(selected)
    onClose()
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={t('appearance')}>
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
        aria-label={t('apply')}
        style={{
          width: '100%', padding: '11px 0', fontSize: 13, fontWeight: 600,
          minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--c-btn-primary)', border: 'none',
          borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
          color: '#fff',
        }}
      >
        {t('apply')}
      </button>
    </BottomSheet>
  )
}

// ─── Language sheet ────────────────────────────────────────────────────────────
// Mirrors AppearanceSheet so the Language row's chevron is honest: it opens a
// chooser (explicit select + Apply) rather than silently flipping en↔vi on tap.

function LanguageSheet({ open, onClose, onApply, currentLocale }: {
  open: boolean
  onClose: () => void
  onApply: (next: string) => void
  currentLocale: string
}) {
  const t = useTranslations('settings')
  const [selected, setSelected] = useState(currentLocale)

  useEffect(() => {
    if (open) setSelected(currentLocale)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const options = [
    { v: 'en', label: t('languageEnglish') },
    { v: 'vi', label: t('languageVietnamese') },
  ]

  function handleApply() {
    onApply(selected)
    onClose()
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={t('language')}>
      <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
        {options.map(opt => (
          <button
            key={opt.v}
            onClick={() => setSelected(opt.v)}
            style={{
              width: '100%', textAlign: 'left', padding: '14px 16px', minHeight: 44,
              background: selected === opt.v ? 'var(--c-navy-tint)' : 'var(--c-card)',
              border: `1.5px solid ${selected === opt.v ? 'var(--c-navy)' : 'var(--c-line)'}`,
              borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 12, transition: 'all 120ms',
            }}
          >
            <span style={{ color: selected === opt.v ? 'var(--c-navy)' : 'var(--c-muted)' }}><Globe size={18} /></span>
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
        aria-label={t('apply')}
        style={{
          width: '100%', padding: '11px 0', fontSize: 13, fontWeight: 600,
          minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--c-btn-primary)', border: 'none',
          borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
          color: '#fff',
        }}
      >
        {t('apply')}
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
  const t = useTranslations('settings')
  const router = useRouter()
  const [, startTransition] = useTransition()
  const { setMobileTopBar, setUserName } = useNavigation()
  const { theme: currentTheme } = useTheme()

  const supabase = useMemo(
    () => createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ),
    []
  )

  const [localDisplayName, setLocalDisplayName] = useState(displayName)

  const localInitials = localDisplayName
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('') || initials

  const [showProfile, setShowProfile] = useState(false)
  const [showLanguage, setShowLanguage] = useState(false)
  const [showAppearance, setShowAppearance] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const [overviewCache, setOverviewCache] = useState<DashboardData | null>(null)

  // Persisted theme choice, so the Appearance row reflects the real selection
  // (light/dark/system) instead of a hardcoded label.
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>(currentTheme)
  // Hydrate from the persisted choice after mount (avoids an SSR mismatch); the
  // two lint rules below are intentional for that reason — same as DesktopSettingsView.
  useEffect(() => { setThemeChoice(readThemeChoice(currentTheme)) }, []) // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect

  const [syncing, setSyncing] = useState(false)
  const [syncDone, setSyncDone] = useState(false)
  const [syncFailed, setSyncFailed] = useState(false)
  const [syncLimited, setSyncLimited] = useState(false)
  // undefined = loading, null = never synced, otherwise the last-sync ISO time.
  const [lastSyncIso, setLastSyncIso] = useState<string | null | undefined>(undefined)
  useEffect(() => { fetchLastSync().then(setLastSyncIso) }, [])

  useEffect(() => {
    setMobileTopBar({
      title: t('preferencesTitle'),
      subtitle: t('eyebrow'),
    })
    return () => setMobileTopBar({ title: '' })
  }, [t, setMobileTopBar])

  function switchLocale(next: string) {
    setLocaleCookie(next)
    startTransition(() => router.refresh())
  }

  async function handleSync() {
    setSyncing(true)
    setSyncDone(false)
    setSyncFailed(false)
    setSyncLimited(false)
    const result = await refreshPrices()
    setSyncing(false)
    if (result.ok) {
      setSyncDone(true)
      setLastSyncIso(new Date().toISOString())
      setTimeout(() => setSyncDone(false), 3000)
    } else if (result.reason === 'rate-limited') {
      // Distinct from a failure: nothing is broken, the user just has to wait.
      setSyncLimited(true)
      setTimeout(() => setSyncLimited(false), 3000)
    } else {
      setSyncFailed(true)
      setTimeout(() => setSyncFailed(false), 3000)
    }
  }

  function handleOpenReport() {
    setShowReport(true)
    fetchOverview().then((json) => { if (json) setOverviewCache(json) })
  }

  async function handleExportReport() {
    await exportPortfolioReport(overviewCache, locale)
  }

  async function handleSaveProfile(name: string): Promise<boolean> {
    const { error } = await supabase.auth.updateUser({ data: { display_name: name } })
    if (error) {
      toast.error(t('saveFailed'))
      return false
    }
    setLocalDisplayName(name)
    setUserName(name)
    return true
  }

  async function handleSignOut() {
    const { error } = await supabase.auth.signOut()
    if (error) {
      toast.error(t('signOutFailed'))
    } else {
      clearAppCaches()
      router.push('/auth/login')
    }
  }

  const localeLabel = locale === 'vi' ? t('languageVietnamese') : t('languageEnglish')
  const appearanceLabel = themeChoice === 'dark'
    ? t('appearanceDark')
    : themeChoice === 'light'
    ? t('appearanceLight')
    : t('appearanceSystem')

  // Rate-limited is neutral, not negative: nothing failed, the user is early.
  const syncStatusColor = syncDone
    ? 'var(--c-pos)'
    : syncFailed
    ? 'var(--c-neg)'
    : 'var(--c-muted)'

  return (
    <>
      <div className="md:hidden -mx-4 -mt-4" style={{ background: 'var(--c-canvas)', minHeight: '100%' }}>
      <div style={{ padding: '4px 16px 80px' }}>

        {/* Profile card */}
        <button
          onClick={() => setShowProfile(true)}
          aria-label={t('profile')}
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
            {t('preferences')}
          </div>
          <div style={{ background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
            <SettingsRow
              icon={<Globe size={16} />}
              label={t('language')}
              value={localeLabel}
              onClick={() => setShowLanguage(true)}
            />
            <SettingsRow
              icon={<Sun size={16} />}
              label={t('appearance')}
              value={appearanceLabel}
              onClick={() => setShowAppearance(true)}
              last
            />
          </div>
        </section>

        {/* Price sync section */}
        <section style={{ marginTop: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-muted)', marginBottom: 8, paddingLeft: 4 }}>
            {t('priceSync')}
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
                  {t('syncAllPrices')}
                </div>
                <div style={{ fontSize: 11, color: syncStatusColor, marginTop: 2, transition: 'color 200ms' }}>
                  {syncing
                    ? t('syncUpdating')
                    : syncDone
                    ? t('syncUpdated')
                    : syncLimited
                    ? t('syncRateLimited')
                    : syncFailed
                    ? t('syncFailed')
                    : `${t('lastSyncedPrefix')}${formatLastSync(lastSyncIso, locale)}`}
                </div>
              </div>
              <button
                onClick={handleSync}
                disabled={syncing}
                aria-label={t('syncNow')}
                style={{
                  padding: '7px 14px', fontSize: 12, fontWeight: 600,
                  minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--c-btn-primary)', border: 'none', borderRadius: 8,
                  color: '#fff', cursor: syncing ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', opacity: syncing ? 0.6 : 1,
                  transition: 'opacity 150ms',
                }}
              >
                {syncing ? t('syncingShort') : t('syncNow')}
              </button>
            </div>

            {/* Source rows */}
            <div style={{ display: 'grid', gap: 8, padding: '12px 0 0', borderTop: '1px solid var(--c-line)' }}>
              {[
                {
                  icon: <TrendingUp size={14} />,
                  color: '#2563eb',
                  label: t('fundNav'),
                  note: t('fundNavNote'),
                },
                {
                  icon: <Coins size={14} />,
                  color: 'var(--c-fund-gold)',
                  label: t('goldPrice'),
                  note: t('goldNote'),
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

        {/* Data section — after Price sync, matching the desktop right column */}
        <section style={{ marginTop: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-muted)', marginBottom: 8, paddingLeft: 4 }}>
            {t('data')}
          </div>
          <div style={{ background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 16, overflow: 'hidden', boxShadow: 'var(--shadow-card)' }}>
            <SettingsRow
              icon={<Download size={16} />}
              label={t('exportData')}
              onClick={handleOpenReport}
              last
            />
          </div>
        </section>

        {/* Sign out */}
        <button
          onClick={handleSignOut}
          aria-label={t('signOut')}
          style={{
            width: '100%', marginTop: 22, padding: '13px 14px', minHeight: 44,
            background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 10,
            color: 'var(--c-neg)', fontSize: 13, fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            cursor: 'pointer', fontFamily: 'inherit', boxShadow: 'var(--shadow-card)',
          }}
        >
          <LogOut size={16} />
          {t('signOut')}
        </button>

        {/* Version */}
        <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--c-muted)', marginTop: 16 }}>
          Cairn v0.4 · {t('versionTag')}
        </p>
      </div>
      </div>

      {/* Sheets */}
      <ProfileSheet
        open={showProfile}
        onClose={() => setShowProfile(false)}
        onSave={handleSaveProfile}
        displayName={localDisplayName}
        email={email}
      />
      <LanguageSheet
        open={showLanguage}
        onClose={() => setShowLanguage(false)}
        onApply={switchLocale}
        currentLocale={locale}
      />
      <AppearanceSheet
        open={showAppearance}
        onClose={() => setShowAppearance(false)}
        onApply={setThemeChoice}
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
