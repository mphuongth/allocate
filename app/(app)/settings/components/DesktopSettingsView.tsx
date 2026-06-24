'use client'

import { useState, useEffect, useMemo, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { useTheme, type ThemeChoice } from '@/app/components/ThemeProvider'
import { useNavigation } from '@/app/components/navigation/NavigationContext'
import {
  Sun, Moon, Settings, RefreshCw, TrendingUp,
  Coins, LogOut, Download, X, Check, Edit2,
} from 'lucide-react'
import { toast } from 'sonner'
import DownloadReportSheet from '@/app/assets/components/DownloadReportSheet'
import type { DashboardData } from '@/app/assets/DashboardClient'
import { clearAppCaches, setLocaleCookie, refreshPrices, fetchOverview, exportPortfolioReport, fetchLastSync, formatLastSync } from '../settingsShared'

interface Props {
  email: string
  initials: string
  displayName: string
}

// How long the "Saved" success flash stays up before the modal closes.
// Kept in sync with MobileSettingsView so both views feel identical.
const SAVE_FLASH_MS = 1400

// ─── Desktop Modal ─────────────────────────────────────────────────────────────

function DModal({ open, onClose, title, children }: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}) {
  if (!open) return null
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15,23,42,0.4)',
        zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, backdropFilter: 'blur(2px)',
        animation: 'fade-in 150ms ease',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
        style={{
          width: 400, maxWidth: '100%',
          background: 'var(--c-card)', borderRadius: 'var(--r-card)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
          animation: 'pop-in 180ms ease', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--c-line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
          <button onClick={onClose} className="cn-btn ghost" style={{ padding: 6 }} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div style={{ padding: '20px' }}>{children}</div>
      </div>
    </div>
  )
}

// ─── Section card ──────────────────────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="cn-card" style={{ padding: '18px 20px', ...style }}>
      {children}
    </div>
  )
}

function CardLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-muted)', marginBottom: 14, ...style }}>
      {children}
    </div>
  )
}

// ─── Setting row (clickable row with icon, label, chevron) ─────────────────────

function SettingRow({ icon, label, onClick, last = false }: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  last?: boolean
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      style={{
        width: '100%', textAlign: 'left',
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 0',
        background: 'transparent', border: 'none',
        borderBottom: last ? 'none' : '1px solid var(--c-line)',
        cursor: 'pointer', fontFamily: 'inherit',
        transition: 'opacity 120ms',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.7' }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1' }}
    >
      <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--c-card-2)', color: 'var(--c-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {icon}
      </div>
      <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--c-ink)' }}>{label}</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function DesktopSettingsView({ email, initials, displayName }: Props) {
  const locale = useLocale()
  const t = useTranslations('settings')
  const router = useRouter()
  const [, startTransition] = useTransition()
  const { theme: currentTheme, setTheme } = useTheme()
  const { setUserName } = useNavigation()

  const supabase = useMemo(
    () => createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ),
    []
  )

  const [localDisplayName, setLocalDisplayName] = useState(displayName)
  const localInitials = localDisplayName
    .split(/\s+/).slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '').join('') || initials

  // Modals
  const [showProfile, setShowProfile] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)
  const [profileName, setProfileName] = useState(displayName)

  // Appearance — read from localStorage so it matches the actual active choice
  const storedTheme = (): ThemeChoice => {
    if (typeof localStorage === 'undefined') return currentTheme
    const v = localStorage.getItem('theme')
    return (v === 'light' || v === 'dark') ? v : 'system'
  }
  const [selectedTheme, setSelectedTheme] = useState<ThemeChoice>(currentTheme)
  // Sync to the persisted theme after mount (kept in an effect to avoid an SSR
  // hydration mismatch; both lint rules below are intentional for that reason).
  useEffect(() => { setSelectedTheme(storedTheme()) }, []) // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect

  // Price sync
  const [syncing, setSyncing] = useState(false)
  const [syncDone, setSyncDone] = useState(false)
  const [syncFailed, setSyncFailed] = useState(false)
  // undefined = loading, null = never synced, otherwise the last-sync ISO time.
  const [lastSyncIso, setLastSyncIso] = useState<string | null | undefined>(undefined)
  useEffect(() => { fetchLastSync().then(setLastSyncIso) }, [])

  // Export
  const [showReport, setShowReport] = useState(false)
  const [overviewCache, setOverviewCache] = useState<DashboardData | null>(null)

  function switchLocale(next: string) {
    setLocaleCookie(next)
    startTransition(() => router.refresh())
  }

  function handleTheme(v: ThemeChoice) {
    setSelectedTheme(v)
    setTheme(v)
  }

  async function handleSync() {
    setSyncing(true)
    setSyncDone(false)
    setSyncFailed(false)
    const ok = await refreshPrices()
    setSyncing(false)
    if (ok) {
      setSyncDone(true)
      setLastSyncIso(new Date().toISOString())
      setTimeout(() => setSyncDone(false), 3000)
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

  function handleOpenProfile() {
    setProfileName(localDisplayName)
    setProfileSaved(false)
    setShowProfile(true)
  }

  async function handleSaveProfile() {
    // Persist first; only flash "Saved" once it succeeds. A failed update
    // surfaces a toast and keeps the modal open instead of faking success.
    const { error } = await supabase.auth.updateUser({ data: { display_name: profileName } })
    if (error) {
      toast.error(t('saveFailed'))
      return
    }
    setLocalDisplayName(profileName)
    setUserName(profileName)
    setProfileSaved(true)
    setTimeout(() => { setProfileSaved(false); setShowProfile(false) }, SAVE_FLASH_MS)
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

  const themeOptions: { v: ThemeChoice; icon: React.ReactNode; label: string }[] = [
    { v: 'light',  icon: <Sun size={13} color="currentColor" />,      label: t('appearanceLight')  },
    { v: 'dark',   icon: <Moon size={13} color="currentColor" />,     label: t('appearanceDark')   },
    { v: 'system', icon: <Settings size={13} color="currentColor" />, label: t('appearanceSystem') },
  ]

  const syncStatusColor = syncDone ? 'var(--c-pos)' : syncFailed ? 'var(--c-neg)' : 'var(--c-muted)'

  return (
    <div data-testid="desktop-settings-view" className="hidden md:flex" style={{ flex: 1, flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>

      {/* ─── Page header ──────────────────────────────────────────────────── */}
      <div style={{ padding: '20px 28px 16px', borderBottom: '1px solid var(--c-line)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--c-canvas)' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-muted)', marginBottom: 3 }}>
            {t('eyebrow')}
          </div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1, color: 'var(--c-ink)' }}>
            {t('preferencesTitle')}
          </h1>
        </div>
      </div>

      {/* ─── Scrollable content ────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px 40px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, maxWidth: 900 }}>

          {/* ── Left column ─────────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Profile */}
            <Card>
              <CardLabel>{t('profile')}</CardLabel>
              <div data-testid="desktop-profile-card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{
                  width: 52, height: 52, borderRadius: 26,
                  background: 'var(--c-btn-primary)', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, fontWeight: 700, letterSpacing: '0.02em', flexShrink: 0,
                }}>
                  {localInitials}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-ink)' }}>{localDisplayName}</div>
                  <div style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 2 }}>{email}</div>
                </div>
                <button
                  onClick={handleOpenProfile}
                  className="cn-btn ghost"
                  style={{ padding: '6px 12px', fontSize: 12, gap: 5, display: 'flex', alignItems: 'center' }}
                >
                  <Edit2 size={13} />
                  {t('edit')}
                </button>
              </div>
            </Card>

            {/* Preferences */}
            <Card>
              <CardLabel style={{ marginBottom: 4 }}>{t('preferences')}</CardLabel>

              {/* Language */}
              <div style={{ padding: '13px 0', borderBottom: '1px solid var(--c-line)' }}>
                <div style={{ fontSize: 11, color: 'var(--c-muted)', marginBottom: 8 }}>
                  {t('language')}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[{ v: 'en', l: t('languageEnglish') }, { v: 'vi', l: t('languageVietnamese') }].map(o => (
                    <button
                      key={o.v}
                      onClick={() => switchLocale(o.v)}
                      style={{
                        padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                        background: locale === o.v ? 'var(--c-btn-primary)' : 'var(--c-card-2)',
                        color: locale === o.v ? '#fff' : 'var(--c-muted)',
                        border: `1px solid ${locale === o.v ? 'var(--c-btn-primary)' : 'var(--c-line)'}`,
                        cursor: 'pointer', fontFamily: 'inherit', transition: 'all 120ms',
                      }}
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
              </div>

              {/* Appearance */}
              <div style={{ padding: '13px 0' }}>
                <div style={{ fontSize: 11, color: 'var(--c-muted)', marginBottom: 8 }}>
                  {t('appearance')}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {themeOptions.map(o => (
                    <button
                      key={o.v}
                      onClick={() => handleTheme(o.v)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                        background: selectedTheme === o.v ? 'var(--c-navy-tint)' : 'var(--c-card-2)',
                        color: selectedTheme === o.v ? 'var(--c-navy)' : 'var(--c-muted)',
                        border: `1px solid ${selectedTheme === o.v ? 'var(--c-navy)' : 'var(--c-line)'}`,
                        cursor: 'pointer', fontFamily: 'inherit', transition: 'all 120ms',
                      }}
                    >
                      {o.icon}
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            </Card>

            {/* Sign out */}
            <button
              onClick={handleSignOut}
              aria-label={t('signOut')}
              style={{
                width: '100%', padding: '12px 16px',
                background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 12,
                color: 'var(--c-neg)', fontSize: 13, fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                cursor: 'pointer', fontFamily: 'inherit', transition: 'background 120ms',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--c-neg-tint)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--c-card)' }}
            >
              <LogOut size={16} color="var(--c-neg)" />
              {t('signOut')}
            </button>

            <p style={{ margin: 0, fontSize: 11, color: 'var(--c-muted)', textAlign: 'center' }}>
              Cairn v0.4 · {t('versionTag')}
            </p>
          </div>

          {/* ── Right column ─────────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Price sync */}
            <Card>
              <CardLabel>{t('priceSync')}</CardLabel>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--c-navy-tint)', color: 'var(--c-navy)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <RefreshCw size={15} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)' }}>
                    {t('syncAllPrices')}
                  </div>
                  <div style={{ fontSize: 11, color: syncStatusColor, marginTop: 2, transition: 'color 200ms' }}>
                    {syncing
                      ? t('syncUpdating')
                      : syncDone
                      ? t('syncUpdated')
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
                    background: 'var(--c-btn-primary)', border: 'none', borderRadius: 8,
                    color: '#fff', cursor: syncing ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit', opacity: syncing ? 0.6 : 1, transition: 'opacity 150ms',
                  }}
                >
                  {syncing ? t('syncingShort') : t('syncNow')}
                </button>
              </div>
              <div style={{ display: 'grid', gap: 10, paddingTop: 12, borderTop: '1px solid var(--c-line)' }}>
                {[
                  { icon: <TrendingUp size={13} />, color: '#2563eb', label: t('fundNav'),   note: t('fundNavNote') },
                  { icon: <Coins size={13} />, color: 'var(--c-fund-gold)', label: t('goldPrice'), note: t('goldNote') },
                ].map((row, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--c-card-2)', color: row.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {row.icon}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-ink)' }}>{row.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 1 }}>{row.note}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Data */}
            <Card>
              <CardLabel style={{ marginBottom: 4 }}>{t('data')}</CardLabel>
              <SettingRow
                icon={<Download size={15} />}
                label={t('exportData')}
                onClick={handleOpenReport}
                last
              />
            </Card>

          </div>
        </div>
      </div>

      {/* ─── Edit profile modal ─────────────────────────────────────────────── */}
      <DModal open={showProfile} onClose={() => { setShowProfile(false); setProfileSaved(false) }} title={t('profileModalTitle')}>
        {profileSaved ? (
          <div style={{ padding: '28px 0', textAlign: 'center' }}>
            <div style={{ width: 52, height: 52, borderRadius: 26, background: 'var(--c-pos-tint)', color: 'var(--c-pos)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
              <Check size={26} strokeWidth={2.5} />
            </div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{t('saved')}</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 14 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-muted)', display: 'block', marginBottom: 6 }}>
                {t('fullName')}
              </label>
              <input
                value={profileName}
                onChange={e => setProfileName(e.target.value)}
                autoFocus
                style={{
                  width: '100%', padding: '9px 12px', fontSize: 13,
                  background: 'var(--c-canvas)', border: '1px solid var(--c-line)',
                  borderRadius: 'var(--r-control)', color: 'var(--c-ink)',
                  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
                }}
                onFocus={e => { (e.target as HTMLInputElement).style.borderColor = 'var(--c-navy)' }}
                onBlur={e => { (e.target as HTMLInputElement).style.borderColor = 'var(--c-line)' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--c-muted)', display: 'block', marginBottom: 6 }}>
                {t('email')}
              </label>
              <input
                type="email"
                defaultValue={email}
                readOnly
                style={{
                  width: '100%', padding: '9px 12px', fontSize: 13,
                  background: 'var(--c-card-2)', border: '1px solid var(--c-line)',
                  borderRadius: 'var(--r-control)', color: 'var(--c-muted)',
                  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button
                onClick={() => setShowProfile(false)}
                className="cn-btn ghost"
                style={{ flex: 1, justifyContent: 'center', border: '1px solid var(--c-line)' }}
              >
                {t('cancel')}
              </button>
              <button
                onClick={handleSaveProfile}
                className="cn-btn primary"
                style={{ flex: 2, justifyContent: 'center' }}
              >
                {t('save')}
              </button>
            </div>
          </div>
        )}
      </DModal>

      {/* ─── Download report sheet ──────────────────────────────────────────── */}
      <DownloadReportSheet
        open={showReport}
        onClose={() => setShowReport(false)}
        desktop
        data={overviewCache ? {
          netWorth: overviewCache.netWorth.netWorth,
          currentValue: overviewCache.netWorth.currentValue,
          totalPL: overviewCache.netWorth.overallProfitLoss,
          goalCount: overviewCache.goals.length,
        } : null}
        onExport={handleExportReport}
      />
    </div>
  )
}
