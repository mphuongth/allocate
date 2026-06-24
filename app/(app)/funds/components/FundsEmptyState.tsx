'use client'

import { useTranslations } from 'next-intl'
import { Library, Plus } from 'lucide-react'

// First-run state for the Fund Library when the account has no funds yet.
// Migrated off the raw 📚 emoji to a lucide icon + design tokens so it matches
// the Overview empty state (OverviewEmptyState, #363 review #1). Both the mobile
// and desktop views wrap this in their own card container; this component only
// owns the centered icon + copy + add action.
export function FundsEmptyState({ onAdd }: { onAdd: () => void }) {
  const t = useTranslations('funds')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div
        style={{
          width: 56, height: 56, borderRadius: 14, marginBottom: 14,
          background: 'var(--c-navy-tint)', color: 'var(--c-navy)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Library size={26} strokeWidth={1.75} />
      </div>
      <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600, color: 'var(--c-ink)' }}>{t('empty')}</h3>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--c-muted)', maxWidth: 320, lineHeight: 1.5 }}>{t('emptyDesc')}</p>
      <button
        type="button"
        onClick={onAdd}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px',
          fontSize: 13, fontWeight: 600, background: 'var(--c-btn-primary)', color: '#fff',
          border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <Plus size={14} strokeWidth={2.4} />
        {t('add')}
      </button>
    </div>
  )
}
