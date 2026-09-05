'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { TrendingUp } from 'lucide-react'
import { DEFAULT_INFLATION_RATE_PCT } from '@/lib/inflation'
import { useManagedTimeout } from '@/components/ui/useManagedTimeout'
import { SAVE_FLASH_MS } from '@/features/settings/settingsOptions'

// The app's only planning assumption, and the only control for it.
//
// An EMPTY field is the honest default state: "I have not chosen", which every
// reader answers with DEFAULT_INFLATION_RATE_PCT. A typed 0 is a different
// answer — "assume no inflation" — and is stored as 0. The card must never
// collapse the two, which is why the draft is a string and only converted at the
// point of saving.
//
// The hint carries the published record because the honest question about this
// field is "how would I know what to put here". It also says the number is an
// assumption: CPI is measured per year after the fact, but a goal maturing in
// 2030 depends on years nobody has lived, so a year landing above or below is
// not a reason to come back and edit this.

// Shared with the route's validator and the column's CHECK constraint. A UI that
// let a rejected value through would turn a typo into a toast about a 400.
const MAX_RATE_PCT = 100

/** The draft as a number, or null for "not chosen" — undefined when unusable. */
function parseDraft(draft: string): number | null | undefined {
  const trimmed = draft.trim()
  if (trimmed === '') return null
  // A Vietnamese keyboard types 4,5 for four and a half.
  const n = Number(trimmed.replace(',', '.'))
  if (!Number.isFinite(n) || n < 0 || n > MAX_RATE_PCT) return undefined
  return n
}

export default function InflationRateCard() {
  const t = useTranslations('settings')
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const scheduleFlashReset = useManagedTimeout()

  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/user-settings', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(res => {
        // A failed read leaves the field empty rather than blocking the page:
        // the assumption is commentary, and the app default still applies.
        if (!cancelled && res?.inflation_rate_pct != null) setDraft(String(res.inflation_rate_pct))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const parsed = parseDraft(draft)
  const invalid = parsed === undefined

  const save = useCallback(async () => {
    const value = parseDraft(draft)
    if (value === undefined) return
    setSaving(true)
    try {
      const res = await fetch('/api/v1/user-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inflation_rate_pct: value }),
      })
      if (!res.ok) throw new Error('save failed')
      setSaved(true)
      scheduleFlashReset(() => setSaved(false), SAVE_FLASH_MS)
    } catch {
      toast.error(t('inflationSaveFailed'))
    } finally {
      setSaving(false)
    }
  }, [draft, scheduleFlashReset, t])

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--c-navy-tint)', color: 'var(--c-navy)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <TrendingUp size={15} />
        </div>
        <label htmlFor="inflation-rate" style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--c-ink)' }}>
          {t('inflationRate')}
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            id="inflation-rate"
            type="text"
            inputMode="decimal"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={String(DEFAULT_INFLATION_RATE_PCT)}
            aria-invalid={invalid}
            style={{
              width: 68, padding: '7px 10px', textAlign: 'right',
              background: 'var(--c-card-2)', color: 'var(--c-ink)',
              border: `1px solid ${invalid ? 'var(--c-neg)' : 'var(--c-line)'}`,
              borderRadius: 8, fontSize: 13, fontWeight: 600,
              fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums', outline: 'none',
            }}
          />
          <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{t('inflationUnit')}</span>
        </div>
        <button
          onClick={save}
          disabled={invalid || saving}
          // Named apart from the profile editor's Save: the page carries two,
          // and "Save" alone leaves a screen reader without a way to tell them
          // apart. The visible label stays short.
          aria-label={t('inflationSave')}
          style={{
            padding: '7px 14px', fontSize: 12, fontWeight: 600,
            background: 'var(--c-btn-primary)', border: 'none', borderRadius: 8,
            color: '#fff', cursor: invalid || saving ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit', opacity: invalid || saving ? 0.6 : 1, transition: 'opacity 150ms',
          }}
        >
          {t('save')}
        </button>
      </div>

      {saved && (
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-pos)' }}>{t('saved')}</div>
      )}
      {invalid && (
        <div role="alert" style={{ fontSize: 12, color: 'var(--c-neg)' }}>{t('inflationRangeError')}</div>
      )}

      <p data-testid="inflation-rate-hint" style={{ margin: 0, fontSize: 11, color: 'var(--c-muted)', lineHeight: 1.5 }}>
        {t('inflationHint')} {t('inflationDefaultNote')}
      </p>
    </div>
  )
}
