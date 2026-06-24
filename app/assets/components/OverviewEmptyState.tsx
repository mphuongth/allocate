'use client'

import { useTranslations } from 'next-intl'
import { BarChart3, Target, Wallet, Shield, ChevronRight } from 'lucide-react'

// First-run onboarding shown when the account has no goals / funds / insurance.
// Migrated off the legacy raw-Tailwind-indigo + emoji markup to Cairn design
// tokens + lucide icons so it matches the rest of the app (#363 review #1).
// The goal/insurance actions open the in-page sheets (onAddGoal/onAddInsurance)
// instead of bouncing the user to /settings; only the fund action navigates,
// to the real fund library page.

const cardStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  width: '100%',
  textAlign: 'left',
  background: 'var(--c-card)',
  border: '1px solid var(--c-line)',
  borderRadius: 12,
  padding: '14px 18px',
  boxShadow: 'var(--shadow-card)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  color: 'inherit',
  textDecoration: 'none',
}

const iconBox: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 10,
  flexShrink: 0,
  background: 'var(--c-navy-tint)',
  color: 'var(--c-navy)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

function ActionRow({ Icon, title, desc }: { Icon: typeof Target; title: string; desc: string }) {
  return (
    <>
      <span style={iconBox}><Icon size={20} strokeWidth={1.75} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 600, fontSize: 14, color: 'var(--c-ink)' }}>{title}</span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--c-muted)', marginTop: 2 }}>{desc}</span>
      </span>
      <ChevronRight size={18} color="var(--c-muted-2)" style={{ flexShrink: 0 }} />
    </>
  )
}

export function OverviewEmptyState({ onAddGoal, onAddInsurance }: { onAddGoal: () => void; onAddInsurance: () => void }) {
  const t = useTranslations('dashboard')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '64px 16px' }}>
      {/* Hero icon */}
      <div style={{ width: 80, height: 80, borderRadius: 20, background: 'var(--c-navy-tint)', color: 'var(--c-navy)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
        <BarChart3 size={36} strokeWidth={1.5} />
      </div>

      {/* Title & description */}
      <h2 style={{ fontSize: 24, fontWeight: 700, color: 'var(--c-ink)', margin: '0 0 8px', textAlign: 'center' }}>{t('empty')}</h2>
      <p style={{ color: 'var(--c-muted)', textAlign: 'center', maxWidth: 360, margin: '0 0 40px', lineHeight: 1.5 }}>{t('emptyDesc')}</p>

      {/* Action cards */}
      <div style={{ width: '100%', maxWidth: 420, display: 'grid', gap: 12, marginBottom: 32 }}>
        <button type="button" onClick={onAddGoal} style={cardStyle}>
          <ActionRow Icon={Target} title={t('addGoal')} desc={t('addGoalDesc')} />
        </button>
        <a href="/funds" style={cardStyle}>
          <ActionRow Icon={Wallet} title={t('addFund')} desc={t('addFundDesc')} />
        </a>
        <button type="button" onClick={onAddInsurance} style={cardStyle}>
          <ActionRow Icon={Shield} title={t('addInsurance')} desc={t('addInsuranceDesc')} />
        </button>
      </div>

      {/* Divider + Settings link */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', maxWidth: 420, marginBottom: 20 }}>
        <div style={{ flex: 1, height: 1, background: 'var(--c-line)' }} />
        <span style={{ fontSize: 12, color: 'var(--c-muted)', whiteSpace: 'nowrap' }}>{t('orManage')}</span>
        <div style={{ flex: 1, height: 1, background: 'var(--c-line)' }} />
      </div>
      <a
        href="/settings"
        style={{ padding: '10px 24px', background: 'var(--c-btn-primary)', color: '#fff', fontSize: 14, fontWeight: 600, borderRadius: 10, textDecoration: 'none' }}
      >
        {t('settingsLink')}
      </a>
    </div>
  )
}
