'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { X, Mountain, Home, Shield, ShoppingCart, Target } from 'lucide-react'
import { iconHit } from './iconHit'
import { fmt } from '@/lib/formatters'
import { formatIntVN, parseIntVN } from '@/lib/numberFormat'
import { CairnLoader } from '@/app/components/ui/CairnLoader'
import { useDialogMount, useResetOnOpen } from '@/components/ui/useDialogMount'
import { monthsUntilYm } from '@/lib/dates'

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  desktop?: boolean
}

const GOAL_ICONS = [
  { v: 'mountains', Icon: Mountain, label: 'Retirement' },
  { v: 'home',      Icon: Home,     label: 'House' },
  { v: 'shield',    Icon: Shield,   label: 'Emergency' },
  { v: 'cart',      Icon: ShoppingCart, label: 'Purchase' },
  { v: 'target',    Icon: Target,   label: 'Other' },
] as const

const PRIORITY_KEYS = ['low', 'med', 'high'] as const
type PriorityKey = typeof PRIORITY_KEYS[number]

export function CreateGoalSheet({ open, onClose, onSuccess, desktop }: Props) {
  const tg = useTranslations('goals')
  const tc = useTranslations('common')

  const [name, setName] = useState('')
  const [target, setTarget] = useState('100000000')
  const [targetDate, setTargetDate] = useState('')
  const [icon, setIcon] = useState<typeof GOAL_ICONS[number]['v']>('target')
  const [priority, setPriority] = useState<PriorityKey>('med')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const mounted = useDialogMount(open)

  // The form used to be wiped after the exit animation finished; clearing it on
  // the way back in is equivalent to the user and doesn't need its own timer.
  useResetOnOpen(open, () => {
    setName('')
    setTarget('100000000')
    setTargetDate('')
    setIcon('target')
    setPriority('med')
    setSaving(false)
    setError('')
  })

  const perMonth = (() => {
    const amount = Number(target)
    if (!amount || !targetDate) return null
    return Math.round(amount / monthsUntilYm(targetDate))
  })()
  const months = targetDate ? monthsUntilYm(targetDate) : null

  async function handleSave() {
    if (!name.trim()) { setError(tg('nameRequired')); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/v1/savings-goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal_name: name.trim(),
          target_amount: target ? Number(target) : null,
          target_date: targetDate || null,
          icon,
          priority,
        }),
      })
      if (!res.ok) {
        const { error: apiError } = await res.json()
        setError(apiError ?? tc('error'))
      } else {
        onClose()
        onSuccess()
      }
    } catch {
      setError(tc('error'))
    }
    setSaving(false)
  }

  if (desktop ? !open : !mounted) return null

  const formContent = (
        <form onSubmit={(e) => { e.preventDefault(); handleSave() }}>
          <div style={{ display: 'grid', gap: 16 }}>
            {error && <p style={{ margin: 0, fontSize: 13, color: 'var(--c-neg)' }}>{error}</p>}

            {/* Name */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-muted)', marginBottom: 6 }}>
                {tg('nameLabelSheet')}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={tg('namePlaceholderSheet')}
                autoFocus
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '10px 12px', fontSize: 16,
                  background: 'var(--c-card-2)', border: '1px solid var(--c-line)',
                  borderRadius: 10, color: 'var(--c-ink)', fontFamily: 'inherit',
                  outline: 'none',
                }}
              />
            </div>

            {/* Target amount */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-muted)', marginBottom: 6 }}>
                {tg('targetLabelSheet')}
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={formatIntVN(target)}
                onChange={(e) => setTarget(parseIntVN(e.target.value))}
                placeholder="100.000.000"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '10px 12px', fontSize: 16, fontVariantNumeric: 'tabular-nums',
                  background: 'var(--c-card-2)', border: '1px solid var(--c-line)',
                  borderRadius: 10, color: 'var(--c-ink)', fontFamily: 'inherit',
                  outline: 'none',
                }}
              />
            </div>

            {/* Target date */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-muted)', marginBottom: 6 }}>
                {tg('targetDateLabelSheet')}
              </label>
              <input
                type="month"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '10px 12px', fontSize: 16,
                  background: 'var(--c-card-2)', border: '1px solid var(--c-line)',
                  borderRadius: 10, color: 'var(--c-ink)', fontFamily: 'inherit',
                  outline: 'none',
                }}
              />
            </div>

            {/* Live save-per-month */}
            {perMonth !== null && (
              <div data-testid="save-per-month" style={{
                background: 'var(--c-navy-tint)', border: '1px solid var(--c-navy-tint)',
                borderRadius: 10, padding: '10px 14px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-navy)' }}>
                    {tg('savePerMonth')}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--c-navy)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(perMonth)} / {tg('month')}
                  </div>
                </div>
                <span style={{
                  background: 'var(--c-card)', borderRadius: 999,
                  padding: '3px 10px', fontSize: 12, fontWeight: 500,
                  color: 'var(--c-navy)',
                }}>
                  {tg('monthsCount', { n: months ?? 0 })}
                </span>
              </div>
            )}

            {/* Icon picker */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-muted)', marginBottom: 6 }}>
                {tg('iconLabel')}
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                {GOAL_ICONS.map(({ v, Icon: IconComponent, label }) => {
                  const active = icon === v
                  return (
                    <button
                      key={v}
                      type="button"
                      data-testid={`goal-icon-btn-${v}`}
                      onClick={() => setIcon(v)}
                      title={label}
                      style={{
                        width: 44, height: 44, borderRadius: 10,
                        background: active ? 'var(--c-btn-primary)' : 'var(--c-card-2)',
                        color: active ? '#fff' : 'var(--c-muted)',
                        border: `1px solid ${active ? 'var(--c-navy)' : 'var(--c-line)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
                        transition: 'background 120ms, border-color 120ms, color 120ms',
                      }}
                    >
                      <IconComponent size={18} strokeWidth={1.8} />
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Priority */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-muted)', marginBottom: 6 }}>
                {tg('priorityLabel')}
              </label>
              <div style={{
                display: 'inline-flex', padding: 3, gap: 2,
                background: 'var(--c-card-2)', borderRadius: 10,
                border: '1px solid var(--c-line)',
              }}>
                {PRIORITY_KEYS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    data-testid={`priority-btn-${v}`}
                    onClick={() => setPriority(v)}
                    style={{
                      background: priority === v ? 'var(--c-card)' : 'transparent',
                      color: priority === v ? 'var(--c-ink)' : 'var(--c-muted)',
                      border: 'none',
                      fontSize: 12, fontWeight: 500,
                      padding: '5px 12px',
                      borderRadius: 7,
                      cursor: 'pointer',
                      boxShadow: priority === v ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                      transition: 'all 120ms',
                      fontFamily: 'inherit',
                    }}
                  >
                    {tg(v === 'low' ? 'priorityLow' : v === 'med' ? 'priorityMed' : 'priorityHigh')}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Buttons */}
          <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              style={{
                flex: 1, padding: '11px 0', borderRadius: 10,
                background: 'transparent', border: '1px solid var(--c-line)',
                color: 'var(--c-ink)', fontSize: 14, fontWeight: 500,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              {tc('cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                flex: 2, padding: '11px 0', borderRadius: 10,
                background: 'var(--c-btn-primary)', border: '1px solid var(--c-btn-primary)',
                color: '#fff', fontSize: 14, fontWeight: 500,
                cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving && <CairnLoader size={14} variant="on-dark" />}
              {saving ? tc('saving') : tg('createBtn')}
            </button>
          </div>
        </form>
  )

  if (desktop) {
    return (
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', zIndex: 200,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          animation: 'fade-in 150ms ease', backdropFilter: 'blur(2px)',
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
          style={{
            width: '100%', maxWidth: 460, maxHeight: 'calc(100vh - 48px)',
            background: 'var(--c-card)', borderRadius: 16,
            boxShadow: '0 24px 48px rgba(15,23,42,0.18), 0 8px 16px rgba(15,23,42,0.08)',
            display: 'flex', flexDirection: 'column',
            animation: 'modal-in 200ms cubic-bezier(0.2,0.8,0.2,1)', overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px 14px', borderBottom: '1px solid var(--c-line)', flexShrink: 0 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>{tg('newGoalTitle')}</h3>
            <button onClick={onClose} style={{ ...iconHit, border: 'none', background: 'transparent', borderRadius: 8, cursor: 'pointer', color: 'var(--c-muted)' }} aria-label="Close"><X size={18} /></button>
          </div>
          <div style={{ flex: 1, padding: '18px 20px', overflowY: 'auto' }}>
            {formContent}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15, 23, 42, 0.45)',
        zIndex: 100,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        animation: open ? 'fade-in 180ms ease' : 'fade-out 180ms ease forwards',
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 480, maxHeight: '90dvh',
          background: 'var(--c-card)',
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          display: 'flex', flexDirection: 'column',
          animation: open ? 'slide-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1)' : 'slide-down 180ms ease forwards',
          boxShadow: '0 -8px 24px rgba(0,0,0,0.12)',
        }}
      >
        {/* Drag handle */}
        <div style={{ width: 36, height: 4, background: 'var(--c-line-strong, #cbd5e1)', borderRadius: 999, margin: '6px auto 14px', flexShrink: 0 }} />

        {/* Header — pinned, sits outside the scrollable body */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px 20px', flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: 'var(--c-ink)' }}>{tg('newGoalTitle')}</h3>
          <button
            onClick={onClose}
            style={{ ...iconHit, border: 'none', background: 'transparent', borderRadius: 8, cursor: 'pointer', color: 'var(--c-muted)' }}
            aria-label={tc('cancel')}
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable form body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 32px' }}>
          {formContent}
        </div>
      </div>
    </div>
  )
}
