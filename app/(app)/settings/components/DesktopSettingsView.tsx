'use client'

import { useState, useRef } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { type ThemeChoice } from '@/components/layout/ThemeProvider'
import { useDialogA11y } from '@/components/ui/useDialogA11y'
import {
  Sun, Moon, Settings, RefreshCw, TrendingUp,
  Coins, LogOut, Download, X, Check, Edit2,
} from 'lucide-react'
import DownloadReportSheet from '@/app/assets/components/DownloadReportSheet'
import { useSettingsController } from '../useSettingsController'
import { useManagedTimeout } from '../useManagedTimeout'

interface Props {
  email: string
  initials: string
  displayName: string
}

// How long the "Saved" success flash stays up before the modal closes.
// Kept in sync with MobileSettingsView so both views feel identical.
const SAVE_FLASH_MS = 1400

// ─── Desktop Modal ─────────────────────────────────────────────────────────────

function DModal({ open, onClose, title, dismissOnBackdrop = true, children }: {
  open: boolean
  onClose: () => void
  title: string
  dismissOnBackdrop?: boolean
  children: React.ReactNode
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  // Esc-to-close, focus-trap and focus-restore — same hook the Plan page modals use.
  useDialogA11y(dialogRef, open, onClose)
  if (!open) return null
  return (
    <div
      // Form modals (the profile editor) opt out of backdrop dismissal so a
      // stray click doesn't discard a half-typed name. Esc + Cancel still close.
      onClick={dismissOnBackdrop ? onClose : undefined}
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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        style={{
          width: 400, maxWidth: '100%',
          background: 'var(--c-card)', borderRadius: 'var(--r-card)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
          animation: 'pop-in 180ms ease', overflow: 'hidden', outline: 'none',
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
  const c = useSettingsController({ initials, displayName })

  // Modal state — the desktop's own chrome. The editor lives inline here rather
  // than in a child component (mobile's ProfileSheet), so its draft and its
  // success flash stay with the modal.
  const [showProfile, setShowProfile] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)
  const [profileName, setProfileName] = useState(displayName)
  const scheduleSaveFlashReset = useManagedTimeout()

  function handleOpenProfile() {
    setProfileName(c.displayName)
    setProfileSaved(false)
    setShowProfile(true)
  }

  async function handleSaveProfile() {
    // Only flash "Saved" and close once the persist succeeded — a failed update
    // surfaces a toast (from saveProfile) and keeps the modal open.
    const ok = await c.saveProfile(profileName)
    if (!ok) return
    setProfileSaved(true)
    scheduleSaveFlashReset(() => { setProfileSaved(false); setShowProfile(false) }, SAVE_FLASH_MS)
  }

  const isSyncing = c.syncStatus === 'syncing'

  const themeOptions: { v: ThemeChoice; icon: React.ReactNode; label: string }[] = [
    { v: 'light',  icon: <Sun size={13} color="currentColor" />,      label: t('appearanceLight')  },
    { v: 'dark',   icon: <Moon size={13} color="currentColor" />,     label: t('appearanceDark')   },
    { v: 'system', icon: <Settings size={13} color="currentColor" />, label: t('appearanceSystem') },
  ]

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
                  {c.initials}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-ink)' }}>{c.displayName}</div>
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
                      onClick={() => c.switchLocale(o.v)}
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
                      onClick={() => c.selectTheme(o.v)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                        background: c.themeChoice === o.v ? 'var(--c-navy-tint)' : 'var(--c-card-2)',
                        color: c.themeChoice === o.v ? 'var(--c-navy)' : 'var(--c-muted)',
                        border: `1px solid ${c.themeChoice === o.v ? 'var(--c-navy)' : 'var(--c-line)'}`,
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
              onClick={c.signOut}
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
                  <RefreshCw size={15} style={{ animation: isSyncing ? 'spin 1s linear infinite' : 'none' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)' }}>
                    {t('syncAllPrices')}
                  </div>
                  <div style={{ fontSize: 11, color: c.syncStatusColor, marginTop: 2, transition: 'color 200ms' }}>
                    {c.syncStatusLabel}
                  </div>
                </div>
                <button
                  onClick={c.runSync}
                  disabled={isSyncing}
                  aria-label={t('syncNow')}
                  style={{
                    padding: '7px 14px', fontSize: 12, fontWeight: 600,
                    background: 'var(--c-btn-primary)', border: 'none', borderRadius: 8,
                    color: '#fff', cursor: isSyncing ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit', opacity: isSyncing ? 0.6 : 1, transition: 'opacity 150ms',
                  }}
                >
                  {isSyncing ? t('syncingShort') : t('syncNow')}
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
                onClick={c.openReport}
                last
              />
            </Card>

          </div>
        </div>
      </div>

      {/* ─── Edit profile modal ─────────────────────────────────────────────── */}
      <DModal open={showProfile} onClose={() => { setShowProfile(false); setProfileSaved(false) }} title={t('profileModalTitle')} dismissOnBackdrop={false}>
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
              <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 6 }}>
                {t('emailReadonlyHint')}
              </div>
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
        open={c.showReport}
        onClose={c.closeReport}
        desktop
        data={c.reportSummary}
        onExport={c.exportReport}
      />
    </div>
  )
}
