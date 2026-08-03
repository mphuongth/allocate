'use client'

import { useState, useEffect, useRef } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { type ThemeChoice } from '@/components/layout/ThemeProvider'
import { useDialogA11y } from '@/components/ui/useDialogA11y'
import { Globe, Sun, Download, RefreshCw, LogOut, ChevronRight, Check } from 'lucide-react'
import { useNavigation } from '@/components/navigation/NavigationContext'
import DownloadReportSheet from '@/app/assets/components/DownloadReportSheet'
import { useSettingsController } from '../useSettingsController'
import { useProfileEditor } from '@/features/settings/useProfileEditor'
import {
  themeOptions, themeLabel, localeOptions, localeLabel, priceSources,
  type SettingsViewProps,
} from '@/features/settings/settingsOptions'
import { useDialogMount, useResetOnOpen } from '@/components/ui/useDialogMount'

// ─── Bottom sheet wrapper ──────────────────────────────────────────────────────

function BottomSheet({ open, onClose, title, dismissOnBackdrop = true, children }: {
  open: boolean
  onClose: () => void
  title: string
  dismissOnBackdrop?: boolean
  children: React.ReactNode
}) {
  const mounted = useDialogMount(open)
  const dialogRef = useRef<HTMLDivElement>(null)
  // Esc-to-close, focus-trap and focus-restore — same hook the Plan page sheets use.
  useDialogA11y(dialogRef, open && mounted, onClose)

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
  const { name, setName, saved, save, reset } = useProfileEditor(displayName, onSave, onClose)

  useResetOnOpen(open, reset, displayName)

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
              onClick={save}
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

function AppearanceSheet({ open, onClose, onApply, current }: {
  open: boolean
  onClose: () => void
  onApply: (choice: ThemeChoice) => void
  current: ThemeChoice
}) {
  const t = useTranslations('settings')

  const [selected, setSelected] = useState<ThemeChoice>(current)

  useEffect(() => {
    if (open) setSelected(current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const options = themeOptions(t)

  // onApply is the controller's selectTheme — it both persists the choice and
  // hands it to the theme provider, so the sheet doesn't touch either directly.
  function handleApply() {
    onApply(selected)
    onClose()
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={t('appearance')}>
      <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => setSelected(opt.value)}
            style={{
              width: '100%', textAlign: 'left', padding: '14px 16px',
              background: selected === opt.value ? 'var(--c-navy-tint)' : 'var(--c-card)',
              border: `1.5px solid ${selected === opt.value ? 'var(--c-navy)' : 'var(--c-line)'}`,
              borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 12, transition: 'all 120ms',
            }}
          >
            <span style={{ color: selected === opt.value ? 'var(--c-navy)' : 'var(--c-muted)' }}><opt.Icon size={18} /></span>
            <span style={{ fontSize: 13, fontWeight: 600, color: selected === opt.value ? 'var(--c-navy)' : 'var(--c-ink)', flex: 1 }}>
              {opt.label}
            </span>
            {selected === opt.value && (
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

  const options = localeOptions(t)

  function handleApply() {
    onApply(selected)
    onClose()
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={t('language')}>
      <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => setSelected(opt.value)}
            style={{
              width: '100%', textAlign: 'left', padding: '14px 16px', minHeight: 44,
              background: selected === opt.value ? 'var(--c-navy-tint)' : 'var(--c-card)',
              border: `1.5px solid ${selected === opt.value ? 'var(--c-navy)' : 'var(--c-line)'}`,
              borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 12, transition: 'all 120ms',
            }}
          >
            <span style={{ color: selected === opt.value ? 'var(--c-navy)' : 'var(--c-muted)' }}><opt.Icon size={18} /></span>
            <span style={{ fontSize: 13, fontWeight: 600, color: selected === opt.value ? 'var(--c-navy)' : 'var(--c-ink)', flex: 1 }}>
              {opt.label}
            </span>
            {selected === opt.value && (
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

export default function MobileSettingsView({ email, initials, displayName }: SettingsViewProps) {
  const locale = useLocale()
  const t = useTranslations('settings')
  const { setMobileTopBar } = useNavigation()
  const c = useSettingsController({ initials, displayName })

  // Sheet state — the mobile's own chrome.
  const [showProfile, setShowProfile] = useState(false)
  const [showLanguage, setShowLanguage] = useState(false)
  const [showAppearance, setShowAppearance] = useState(false)

  useEffect(() => {
    setMobileTopBar({
      title: t('preferencesTitle'),
      subtitle: t('eyebrow'),
    })
    return () => setMobileTopBar({ title: '' })
  }, [t, setMobileTopBar])

  const isSyncing = c.syncStatus === 'syncing'

  // Both summaries read off the same option lists the sheets render, so a new
  // choice can't appear in the picker and be missing from the row.
  const currentLocaleLabel = localeLabel(locale, t)
  const appearanceLabel = themeLabel(c.themeChoice, t)

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
            {c.initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-ink)' }}>{c.displayName}</div>
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
              value={currentLocaleLabel}
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
                <RefreshCw size={16} style={{ animation: isSyncing ? 'spin 1s linear infinite' : 'none' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
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
                  minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--c-btn-primary)', border: 'none', borderRadius: 8,
                  color: '#fff', cursor: isSyncing ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', opacity: isSyncing ? 0.6 : 1,
                  transition: 'opacity 150ms',
                }}
              >
                {isSyncing ? t('syncingShort') : t('syncNow')}
              </button>
            </div>

            {/* Source rows */}
            <div style={{ display: 'grid', gap: 8, padding: '12px 0 0', borderTop: '1px solid var(--c-line)' }}>
              {priceSources(t).map((row) => (
                <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 7, background: 'var(--c-card-2)',
                    color: row.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <row.Icon size={14} />
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
              onClick={c.openReport}
              last
            />
          </div>
        </section>

        {/* Sign out */}
        <button
          onClick={c.signOut}
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
        onSave={c.saveProfile}
        displayName={c.displayName}
        email={email}
      />
      <LanguageSheet
        open={showLanguage}
        onClose={() => setShowLanguage(false)}
        onApply={c.switchLocale}
        currentLocale={locale}
      />
      <AppearanceSheet
        open={showAppearance}
        onClose={() => setShowAppearance(false)}
        onApply={c.selectTheme}
        current={c.themeChoice}
      />
      <DownloadReportSheet
        open={c.showReport}
        onClose={c.closeReport}
        data={c.reportSummary}
        onExport={c.exportReport}
      />
    </>
  )
}
