'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Plus, RefreshCw, Search, X, ChevronDown, Check } from 'lucide-react'
import { useNavigation } from '@/components/navigation/NavigationContext'
import { Skeleton } from '@/components/ui/Skeleton'
import { SyncPill } from '@/components/ui/SyncPill'
import { fmtNav, fmtCompact } from '@/lib/formatters'
import { formatIntVN, parseIntVN, formatDecimalVN, parseDecimalVN } from '@/lib/numberFormat'
// Shared dialog a11y (Esc-to-close + focus trap + focus restore). Lives under
// the Plan feature today; reused here so Funds sheets behave the same.
import { TYPE_META, TYPE_FILTERS, FORM_TYPES, filterAndSortFunds, nextSort } from '@/features/funds/fundListModel'
import type { TypeFilter } from '@/features/funds/contracts'
import { useDialogA11y } from '@/components/ui/useDialogA11y'
import PendingButton from '@/components/ui/PendingButton'
import { FundsEmptyState } from './FundsEmptyState'
import { FundNavAge } from './FundNavAge'
import type { Fund, Goal, FundType, FundsData, FundsBusy } from './useFundsData'
import { useFundMutations } from './useFundMutations'
import { useDialogMount } from '@/components/ui/useDialogMount'
import { clickAway } from '@/components/ui/clickAway'

// Matches the design's exact icon paths (stroke-based, strokeWidth 1.75)
const IconEdit = ({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}>
    <path d="M4 20h4l10-10-4-4L4 16z" />
  </svg>
)

const IconTrash = ({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}>
    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
  </svg>
)
// ─── Types ───────────────────────────────────────────────────────────────────
// Fund/Goal/FundType are shared with the desktop view via useFundsData.

type Toast = { id: number; message: string; type: 'success' | 'error' }
type SortKey = 'code' | 'nav' | 'name'

// ─── Constants ───────────────────────────────────────────────────────────────

// i18n key (in the `funds` namespace) for each sort option's label.
const SORT_OPTIONS: Array<{ v: SortKey; key: 'colCode' | 'colNav' | 'colName' }> = [
  { v: 'code', key: 'colCode' },
  { v: 'nav',  key: 'colNav' },
  { v: 'name', key: 'colName' },
]

let toastSeq = 0

// ─── Sort dropdown ────────────────────────────────────────────────────────────

function SortDropdown({ sortKey, sortAsc, onSort }: { sortKey: SortKey; sortAsc: boolean; onSort: (key: SortKey) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const t = useTranslations('funds')
  const current = SORT_OPTIONS.find((s) => s.v === sortKey)

  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', fontSize: 11, fontWeight: 500, background: 'var(--c-card)', color: 'var(--c-ink)', border: '1px solid var(--c-line)', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
      >
        {current ? t(current.key) : ''} {sortAsc ? '↑' : '↓'}
        <ChevronDown size={11} color="var(--c-muted)" />
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, minWidth: 110, background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 10, boxShadow: 'var(--shadow-pop)', zIndex: 100, overflow: 'hidden' }}>
          {SORT_OPTIONS.map((s) => (
            <button
              key={s.v}
              onClick={() => { onSort(s.v); setOpen(false) }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '9px 12px', fontSize: 13, fontWeight: sortKey === s.v ? 600 : 400, color: sortKey === s.v ? 'var(--c-navy)' : 'var(--c-ink)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', gap: 8 }}
            >
              <span>{t(s.key)}</span>
              {sortKey === s.v && <Check size={13} color="var(--c-navy)" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Type dropdown ────────────────────────────────────────────────────────────


function TypeDropdown({ value, onChange }: { value: FundType; onChange: (v: FundType) => void }) {
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const m = TYPE_META[value]

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '10px 12px', fontSize: 13, background: 'var(--c-card)', color: 'var(--c-ink)', border: '1px solid var(--c-line)', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', boxSizing: 'border-box' }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: m.color, flexShrink: 0 }} />
          {locale === 'vi' ? m.labelVi : m.label}
        </span>
        <ChevronDown size={14} color="var(--c-muted)" />
      </button>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 10, boxShadow: 'var(--shadow-pop)', zIndex: 300, overflow: 'hidden' }}>
          {FORM_TYPES.map((ft) => {
            const fm = TYPE_META[ft]
            const active = value === ft
            return (
              <button
                key={ft}
                type="button"
                onClick={() => { onChange(ft); setOpen(false) }}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '11px 12px', fontSize: 13, fontWeight: active ? 600 : 400, color: active ? 'var(--c-navy)' : 'var(--c-ink)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', gap: 8 }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: fm.color, flexShrink: 0 }} />
                  {locale === 'vi' ? fm.labelVi : fm.label}
                </span>
                {active && <Check size={13} color="var(--c-navy)" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Sheet ───────────────────────────────────────────────────────────────────

function Sheet({ open, onClose, testId, ariaLabel, dismissOnBackdrop = true, children }: { open: boolean; onClose: () => void; testId: string; ariaLabel: string; dismissOnBackdrop?: boolean; children: React.ReactNode }) {
  const mounted = useDialogMount(open)
  const sheetRef = useRef<HTMLDivElement>(null)
  useDialogA11y(sheetRef, open, onClose)
  if (!mounted) return null

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.3)', zIndex: 200, pointerEvents: open ? 'auto' : 'none', display: 'flex', alignItems: 'flex-end' }}
      // Form sheets opt out of backdrop dismissal so a stray tap doesn't discard
      // typed input; they're closed via the Cancel button (#2 P2).
      // A selection dragged out of the panel releases here; that is not a
      // click-away, and it used to close the sheet mid-edit.
      {...clickAway(dismissOnBackdrop ? onClose : undefined)}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        data-testid={testId}
        style={{ width: '100%', background: 'var(--c-card)', borderRadius: '16px 16px 0 0', outline: 'none', paddingBottom: 'env(safe-area-inset-bottom,0)', animation: open ? 'slide-up 220ms cubic-bezier(0.2,0.8,0.2,1)' : 'slide-down 180ms ease forwards' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 36, height: 4, background: 'var(--c-line-strong)', borderRadius: 999, margin: '8px auto 0' }} />
        <div style={{ padding: '0 16px 24px' }}>{children}</div>
      </div>
    </div>
  )
}

// ─── TypeChip ────────────────────────────────────────────────────────────────

function TypeChip({ type }: { type: FundType }) {
  const m = TYPE_META[type]
  const locale = useLocale()
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 10, fontWeight: 600, letterSpacing: '0.03em', padding: '2px 7px', borderRadius: 999, background: m.bg, color: m.color }}>
      {locale === 'vi' ? m.labelVi : m.label}
    </span>
  )
}

// ─── FundForm ────────────────────────────────────────────────────────────────

interface SavePayload {
  name: string; code: string; fund_type: FundType; nav: number; nav_auto_sync: boolean
}

function FundForm({ existing, title, onClose, onSave, saving, formError }: {
  existing: Fund | null
  title: string
  onClose: () => void
  onSave: (data: SavePayload) => void
  saving: boolean
  formError: string | null
}) {
  const t = useTranslations('funds')
  const tc = useTranslations('common')
  const [name, setName] = useState(existing?.name ?? '')
  const [code, setCode] = useState(existing?.code ?? '')
  const [type, setType] = useState<FundType>(existing?.fund_type ?? 'equity')
  const [nav, setNav] = useState(existing ? String(existing.nav) : '')
  const [autoSync, setAutoSync] = useState(existing?.nav_auto_sync ?? false)

  // Incompleteness alone greys the button out. A save in flight is blocked by
  // PendingButton itself, and leaving it out of `incomplete` keeps the navy fill
  // behind the loader instead of turning it into a disabled-looking slab.
  const incomplete = !name.trim() || !code.trim() || !nav || Number(nav) <= 0

  const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', fontSize: 16, border: '1px solid var(--c-line)', borderRadius: 10, background: 'var(--c-card)', color: 'var(--c-ink)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }
  const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--c-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }

  return (
    <div style={{ paddingTop: 14, display: 'grid', gap: 14 }}>
      <p style={{ margin: 0, fontWeight: 700, fontSize: 16, color: 'var(--c-ink)' }}>{title}</p>
      {formError && (
        <div style={{ padding: '10px 12px', background: 'var(--c-neg-tint)', color: 'var(--c-neg)', fontSize: 13, borderRadius: 8 }}>
          {formError}
        </div>
      )}
      <div style={{ display: 'grid', gap: 6 }}>
        <label style={labelStyle}>{t('nameLabel')}</label>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={255} placeholder={t('namePlaceholder')} style={inputStyle} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={{ display: 'grid', gap: 6 }}>
          <label style={labelStyle}>{t('codeLabel')}</label>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={50} placeholder={t('codePlaceholder')} style={{ ...inputStyle, fontFamily: 'var(--font-mono,monospace)' }} />
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          <label style={labelStyle}>{t('typeLabel')}</label>
          <TypeDropdown value={type} onChange={setType} />
        </div>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        <label style={labelStyle}>{t('navLabel')}</label>
        <input type="text" inputMode="decimal" value={formatDecimalVN(nav)} onChange={(e) => setNav(parseDecimalVN(e.target.value))} placeholder={t('navPlaceholder')} style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums' }} />
      </div>
      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <input
          type="checkbox"
          checked={autoSync}
          onChange={(e) => setAutoSync(e.target.checked)}
          style={{ marginTop: 2, width: 18, height: 18, accentColor: 'var(--c-navy)' }}
        />
        <span style={{ display: 'grid', gap: 2 }}>
          <span style={{ ...labelStyle, marginBottom: 0 }}>{t('navAutoSyncLabel')}</span>
          <span style={{ fontSize: 11, color: 'var(--c-muted)' }}>{t('navAutoSyncHint')}</span>
        </span>
      </label>
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button onClick={onClose} disabled={saving} style={{ flex: 1, padding: '10px 14px', fontSize: 13, fontWeight: 600, border: '1px solid var(--c-line)', borderRadius: 10, background: 'var(--c-card)', color: 'var(--c-ink)', cursor: 'pointer', fontFamily: 'inherit' }}>
          {tc('cancel')}
        </button>
        <PendingButton
          pending={saving}
          pendingLabel={tc('saving')}
          onClick={() => onSave({ name: name.trim(), code: code.trim(), fund_type: type, nav: Number(nav), nav_auto_sync: autoSync })}
          disabled={incomplete}
          style={{ flex: 2, padding: '10px 14px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 10, background: incomplete ? 'var(--c-line)' : 'var(--c-navy)', color: incomplete ? 'var(--c-muted)' : '#fff', cursor: incomplete ? 'not-allowed' : saving ? 'default' : 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          {t('saveBtn')}
        </PendingButton>
      </div>
    </div>
  )
}

// ─── FundCard ────────────────────────────────────────────────────────────────

function FundCard({ fund, dcaEditId, dcaEditValue, togglingIds, goals, goalLabel, unallocatedLabel, onEdit, onDelete, onToggleDca, onSaveDcaAmount, onCancelDcaEdit, onGoalChange, setDcaEditId, setDcaEditValue, setDcaEditIsNew }: {
  fund: Fund
  dcaEditId: string | null
  dcaEditValue: string
  togglingIds: Set<string>
  goals: Goal[]
  goalLabel: string
  unallocatedLabel: string
  onEdit: () => void
  onDelete: () => void
  onToggleDca: () => void
  onSaveDcaAmount: (val: string) => void
  onCancelDcaEdit: () => void
  onGoalChange: (goalId: string | null) => void
  setDcaEditId: (id: string | null) => void
  setDcaEditValue: (v: string) => void
  setDcaEditIsNew: (v: boolean) => void
}) {
  const t = useTranslations('funds')
  const tc = useTranslations('common')
  const m = TYPE_META[fund.fund_type]
  const isEditing = dcaEditId === fund.id
  const toggling = togglingIds.has(fund.id)

  return (
    <div
      data-testid={`fund-card-${fund.id}`}
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 'var(--r-card,16px)', boxShadow: 'var(--shadow-card)', padding: '12px 14px', display: 'grid', gap: 10 }}
    >
      {/* Row 1 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0, background: m.bg, color: m.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono,monospace)' }}>
          {fund.code.slice(0, 2)}
        </div>
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono,monospace)', color: 'var(--c-ink)' }}>{fund.code}</span>
            <TypeChip type={fund.fund_type} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fund.name}</div>
        </div>
        <div style={{ display: 'flex', flexShrink: 0 }}>
          {/* ≥44px touch targets (#4): icons stay 14px but the button fills 44×44. */}
          <button onClick={onEdit} aria-label={t('editFund')} style={{ minWidth: 44, minHeight: 44, padding: 6, background: 'transparent', border: 'none', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IconEdit size={14} color="var(--c-muted)" />
          </button>
          <button onClick={onDelete} aria-label={t('deleteBtn')} style={{ minWidth: 44, minHeight: 44, padding: 6, background: 'transparent', border: 'none', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IconTrash size={14} color="var(--c-neg)" />
          </button>
        </div>
      </div>

      {/* Row 2: NAV + DCA */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid var(--c-line)', gap: 8 }}>
        <div style={{ flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: 'var(--c-muted)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>NAV</div>
          <div style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {fmtNav(fund.nav)}
          </div>
          {fund.nav_auto_sync && fund.updated_at && (
            <FundNavAge isoStr={fund.updated_at} style={{ fontSize: 10, color: 'var(--c-muted)', marginTop: 1 }} />
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span style={{ fontSize: 10, color: 'var(--c-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>DCA</span>
          {/* ≥44px touch target (#4): the 36×20 track keeps its look but the
              tappable button fills 44×44 around it. */}
          <button
            type="button"
            onClick={onToggleDca}
            disabled={toggling}
            aria-label={fund.is_dca ? t('disableDca') : t('enableDca')}
            style={{ minWidth: 44, minHeight: 44, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: toggling ? 'not-allowed' : 'pointer', flexShrink: 0, opacity: toggling ? 0.5 : 1 }}
          >
            <span style={{ display: 'block', position: 'relative', width: 36, height: 20, borderRadius: 10, background: fund.is_dca ? 'var(--c-btn-primary)' : 'var(--c-line-strong)', transition: 'background 180ms' }}>
              <span style={{ position: 'absolute', top: 2, left: fund.is_dca ? 18 : 2, width: 16, height: 16, borderRadius: 8, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 180ms' }} />
            </span>
          </button>

          {fund.is_dca && (
            isEditing ? (
              <input
                autoFocus
                data-testid={`dca-amount-input-${fund.id}`}
                type="text"
                inputMode="numeric"
                value={formatIntVN(dcaEditValue)}
                onChange={(e) => setDcaEditValue(parseIntVN(e.target.value))}
                onBlur={() => { onSaveDcaAmount(dcaEditValue); setDcaEditId(null) }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { onSaveDcaAmount(dcaEditValue); setDcaEditId(null) }
                  if (e.key === 'Escape') onCancelDcaEdit()
                }}
                placeholder={`${tc('amount')} ₫`}
                style={{ width: 90, padding: '3px 8px', fontSize: 16, border: '1px solid var(--c-navy)', borderRadius: 6, background: 'var(--c-card)', fontFamily: 'inherit', outline: 'none', color: 'var(--c-ink)' }}
              />
            ) : fund.dca_monthly_amount_vnd ? (
              <button
                type="button"
                data-testid={`dca-amount-btn-${fund.id}`}
                // Busy until the save settles: a second amount write stacked on
                // the first leaves each rollback aiming at the other's
                // optimistic value rather than at what the server holds (#590).
                disabled={toggling}
                onClick={() => { setDcaEditId(fund.id); setDcaEditValue(String(fund.dca_monthly_amount_vnd)); setDcaEditIsNew(false) }}
                style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', background: 'var(--c-navy-tint)', color: 'var(--c-navy)', border: '1px solid var(--c-navy-tint)', borderRadius: 6, cursor: toggling ? 'not-allowed' : 'pointer', opacity: toggling ? 0.5 : 1, fontFamily: 'inherit' }}
              >
                {fmtCompact(fund.dca_monthly_amount_vnd)}
              </button>
            ) : (
              <button
                type="button"
                disabled={toggling}
                onClick={() => { setDcaEditId(fund.id); setDcaEditValue(''); setDcaEditIsNew(false) }}
                style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', background: 'var(--c-navy-tint)', color: 'var(--c-navy)', border: '1px solid var(--c-navy-tint)', borderRadius: 6, cursor: toggling ? 'not-allowed' : 'pointer', opacity: toggling ? 0.5 : 1, fontFamily: 'inherit' }}
              >
                {t('setAmount')}
              </button>
            )
          )}

          {/* Goal target — recurring contributions for this fund count toward this goal */}
          {fund.is_dca && (
            <select
              data-testid={`dca-goal-${fund.id}`}
              value={fund.dca_goal_id ?? ''}
              title={goalLabel}
              aria-label={goalLabel}
              // Waits out an in-flight write like the desktop selector already
              // did: the goal PUT carries the amount, so running it during an
              // amount save would persist a value that save hasn't confirmed
              // yet — and the failed save could then no longer tell the
              // server's value from its own optimistic one (#590).
              disabled={toggling}
              onChange={(e) => onGoalChange(e.target.value || null)}
              style={{
                // 16px (not 13) so iOS Safari doesn't zoom the viewport on focus
                // and persist that zoom across reloads (#321).
                fontSize: 16, fontWeight: 500, padding: '3px 6px', maxWidth: 130,
                // minWidth:0 lets the select shrink below its content width so a long
                // goal name truncates with an ellipsis instead of overflowing the card
                // and getting hard-clipped at the right edge (#363).
                minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                border: '1px solid var(--c-line)', borderRadius: 6,
                // --c-ink-2 (not --c-muted): the select holds a real chosen goal, so
                // it needs readable contrast, not faint placeholder-grey.
                background: 'var(--c-card)', color: 'var(--c-ink-2)',
                fontFamily: 'inherit', appearance: 'none', outline: 'none',
                cursor: toggling ? 'not-allowed' : 'pointer', opacity: toggling ? 0.5 : 1,
              }}
            >
              {goals.map((g) => <option key={g.goal_id} value={g.goal_id}>{g.goal_name}</option>)}
              <option value="">{unallocatedLabel}</option>
            </select>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MobileFundLibraryView({ funds, setFunds, goals, loading, error, reload, togglingIds: busyIds, setTogglingIds }: FundsData & FundsBusy) {
  const t = useTranslations('funds')
  const tc = useTranslations('common')
  const locale = useLocale()
  const { setMobileTopBar } = useNavigation()

  // ── Data ──────────────────────────────────────────────────────────────────
  // funds / goals / loading / error / reload come from FundLibraryClient (#10).
  const [refreshing, setRefreshing] = useState(false)

  // ── UI state ──────────────────────────────────────────────────────────────
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<TypeFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('code')
  const [sortAsc, setSortAsc] = useState(true)

  // Sheets
  const [addOpen, setAddOpen] = useState(false)
  const [editFund, setEditFund] = useState<Fund | null>(null)
  const [deleteFund, setDeleteFund] = useState<Fund | null>(null)

  // Form
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // DCA inline edit
  const [dcaEditId, setDcaEditId] = useState<string | null>(null)
  const [dcaEditValue, setDcaEditValue] = useState('')
  // True only while editing a DCA that was *just* toggled on and never persisted.
  // Distinguishes "cancel a brand-new enable" (revert to off) from "clear an
  // already-saved amount" (a no-op cancel — the server still has DCA on, so
  // flipping the local card off would desync until the next reload) (#2).
  const [dcaEditIsNew, setDcaEditIsNew] = useState(false)

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([])

  // ── Helpers ───────────────────────────────────────────────────────────────

  const addToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = ++toastSeq
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000)
  }, [])

  // Shared with the desktop view (#573). Only the toast shape differs, so that
  // is the one thing injected — this view's takes a string, the desktop's a
  // boolean. `deleteFund` is renamed: the confirmation sheet's state already
  // owns that name here.
  const { togglingIds, disableDca, saveDcaAmount, setDcaGoal, deleteFund: runDelete } =
    useFundMutations({
      setFunds,
      reload,
      notify: useCallback((message: string, ok: boolean) => addToast(message, ok ? 'success' : 'error'), [addToast]),
      togglingIds: busyIds,
      setTogglingIds,
    })

  const handleRefreshNav = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/v1/funds/refresh-nav', { method: 'POST' })
      const { results } = await res.json()
      const updated = results.filter((r: { nav?: number }) => r.nav !== undefined).length
      const failed = results.filter((r: { error?: string }) => r.error).length
      await reload()
      addToast(t('navRefreshDone', { updated, failed }), failed > 0 && updated === 0 ? 'error' : 'success')
    } catch {
      addToast(t('toastRefreshFailed'), 'error')
    } finally {
      setRefreshing(false)
    }
  }, [reload, addToast, t])

  useEffect(() => {
    setMobileTopBar({
      title: t('pageTitle'),
      subtitle: t('pageSubtitle'),
      trailing: (
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={handleRefreshNav}
            disabled={refreshing || !funds.some((f) => f.nav_auto_sync)}
            aria-label={t('refreshNav')}
            style={{ padding: 8, background: 'transparent', border: '1px solid var(--c-line)', borderRadius: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', opacity: refreshing || !funds.some((f) => f.nav_auto_sync) ? 0.4 : 1 }}
          >
            <RefreshCw size={16} color="var(--c-ink)" />
          </button>
          <button
            onClick={() => { setFormError(null); setAddOpen(true) }}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'var(--c-btn-primary)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            <Plus size={14} strokeWidth={2.5} />
            {t('add')}
          </button>
        </div>
      ),
    })
    return () => setMobileTopBar({ title: '' })
  }, [t, refreshing, funds, handleRefreshNav, setFormError, setAddOpen, setMobileTopBar])

  // ── Sorted/filtered list ──────────────────────────────────────────────────

  const sortedFunds = useMemo(
    () => filterAndSortFunds(funds, { query, typeFilter: filter, sortKey, sortAsc }),
    [funds, filter, query, sortKey, sortAsc],
  )

  // ── Actions ───────────────────────────────────────────────────────────────

  function handleSort(key: SortKey) {
    const next = nextSort({ sortKey, sortAsc }, key)
    setSortKey(next.sortKey); setSortAsc(next.sortAsc)
  }

  async function handleSave(data: SavePayload, existingId?: string) {
    setFormError(null)
    setSaving(true)
    try {
      const url = existingId ? `/api/funds/${existingId}` : '/api/funds'
      const method = existingId ? 'PUT' : 'POST'
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      const json = await res.json()
      if (!res.ok) {
        setFormError(res.status === 409 ? t('codeExists') : (json.error || t('error')))
        return
      }
      setAddOpen(false)
      setEditFund(null)
      await reload()
      addToast(existingId ? t('toastUpdated') : t('toastAdded'))
    } catch {
      setFormError(t('error'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteFund) return
    setDeleting(true)
    try {
      await runDelete(deleteFund)
    } finally {
      // Dismissed on every outcome, and only once the answer is known — the
      // sheet stays up showing its busy state while the request is in flight.
      // That includes the in-use refusal, which the toast explains.
      setDeleteFund(null)
      setDeleting(false)
    }
  }

  // Turning DCA *on* persists nothing — it opens the inline editor and waits for
  // an amount, which is why this half stays in the view.
  async function handleToggleDca(fund: Fund) {
    if (!fund.is_dca) {
      setFunds((prev) => prev.map((f) => f.id === fund.id ? { ...f, is_dca: true } : f))
      setDcaEditId(fund.id)
      setDcaEditValue('')
      setDcaEditIsNew(true)
      return
    }
    await disableDca(fund)
  }

  async function handleSaveDcaAmount(fund: Fund, val: string) {
    const amount = Number(val)
    const valid = val !== '' && !isNaN(amount) && amount > 0

    if (!valid) {
      // Only a brand-new, never-persisted enable reverts to off. Clearing an
      // already-saved amount is a no-op cancel; the saved card stays as the
      // server has it (#2). Turning DCA off is done via the toggle.
      if (dcaEditIsNew) {
        setFunds((prev) => prev.map((f) => f.id === fund.id ? { ...f, is_dca: false, dca_monthly_amount_vnd: null } : f))
      }
      setDcaEditIsNew(false)
      return
    }

    // Captured before the flag is cleared: it decides what a failed save rolls
    // back to — off for a never-persisted enable, the saved amount otherwise.
    const wasNew = dcaEditIsNew
    setDcaEditIsNew(false)
    await saveDcaAmount(fund, amount, wasNew)
  }

  // Abandon an inline amount edit (Escape). A brand-new enable reverts to off;
  // editing an already-saved amount just closes the editor (#2).
  function handleCancelDcaEdit(fund: Fund) {
    if (dcaEditIsNew) {
      setFunds((prev) => prev.map((f) => f.id === fund.id ? { ...f, is_dca: false, dca_monthly_amount_vnd: null } : f))
    }
    setDcaEditId(null)
    setDcaEditIsNew(false)
  }

  async function handleSetDcaGoal(fund: Fund, goalId: string | null) {
    await setDcaGoal(fund, goalId)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div data-testid="mobile-funds" className="md:hidden" style={{ minHeight: '100dvh', background: 'var(--c-canvas)' }}>
      {/* Background-sync pill while NAV prices refresh */}
      <SyncPill label={t('syncingPrices')} show={refreshing} />

      {/* Toasts */}
      <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 300, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
        {toasts.map((toast) => (
          <div key={toast.id} style={{ padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500, color: '#fff', background: toast.type === 'error' ? 'var(--c-neg)' : 'var(--c-pos)', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', animation: 'fade-in 150ms ease' }}>
            {toast.message}
          </div>
        ))}
      </div>

      <div style={{ padding: '0 0 96px', display: 'grid', gap: 10 }}>
        {/* Search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 10 }}>
          <Search size={16} color="var(--c-muted)" style={{ flexShrink: 0 }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 16, color: 'var(--c-ink)', fontFamily: 'inherit' }}
          />
          {query && (
            <button onClick={() => setQuery('')} style={{ padding: 4, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              <X size={14} color="var(--c-muted)" />
            </button>
          )}
        </div>

        {/* Filter chips + sort */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, flex: 1, flexWrap: 'wrap' }}>
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.v}
                onClick={() => setFilter(f.v)}
                style={{ padding: '5px 10px', borderRadius: 999, fontSize: 11, fontWeight: 500, background: filter === f.v ? 'var(--c-ink)' : 'var(--c-card)', color: filter === f.v ? 'var(--c-card)' : 'var(--c-muted)', border: '1px solid ' + (filter === f.v ? 'var(--c-ink)' : 'var(--c-line)'), cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit', transition: 'background 150ms, color 150ms' }}
              >
                {locale === 'vi' ? f.labelVi : f.label}
              </button>
            ))}
          </div>
          <SortDropdown sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
        </div>

        {/* Count */}
        <div style={{ fontSize: 12, color: 'var(--c-muted)', paddingLeft: 2 }}>
          {t('fundsCount', { count: sortedFunds.length })}
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div style={{ display: 'grid', gap: 8 }} data-testid="funds-loading-skeleton">
            {[...Array(3)].map((_, i) => (
              <div key={i} style={{ background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 16, padding: '12px 14px', display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <Skeleton width={36} height={36} style={{ borderRadius: 8 }} />
                  <div style={{ flex: 1, display: 'grid', gap: 6 }}>
                    <Skeleton width="55%" height={13} />
                    <Skeleton width="75%" height={10} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div style={{ padding: '32px 20px', textAlign: 'center', background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 16 }}>
            <p style={{ color: 'var(--c-neg)', fontSize: 13, margin: '0 0 12px' }}>{t('loadError')}</p>
            <button onClick={() => reload()} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'var(--c-btn-primary)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit' }}>
              {tc('tryAgain')}
            </button>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && funds.length === 0 && (
          <div style={{ padding: '44px 20px', background: 'var(--c-card)', border: '1px dashed var(--c-line-strong)', borderRadius: 16 }}>
            <FundsEmptyState onAdd={() => { setFormError(null); setAddOpen(true) }} />
          </div>
        )}

        {/* No search results */}
        {!loading && !error && funds.length > 0 && sortedFunds.length === 0 && (
          <div style={{ padding: '32px 20px', textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: 'var(--c-muted)', margin: 0 }}>{t('noMatch')}</p>
          </div>
        )}

        {/* Fund list */}
        {!loading && !error && sortedFunds.length > 0 && (
          <div style={{ display: 'grid', gap: 8 }}>
            {sortedFunds.map((fund) => (
              <FundCard
                key={fund.id}
                fund={fund}
                dcaEditId={dcaEditId}
                dcaEditValue={dcaEditValue}
                togglingIds={togglingIds}
                goals={goals}
                goalLabel={t('dcaGoalLabel')}
                unallocatedLabel={t('dcaGoalUnallocated')}
                onEdit={() => { setFormError(null); setEditFund(fund) }}
                onDelete={() => setDeleteFund(fund)}
                onToggleDca={() => handleToggleDca(fund)}
                onSaveDcaAmount={(val) => handleSaveDcaAmount(fund, val)}
                onCancelDcaEdit={() => handleCancelDcaEdit(fund)}
                onGoalChange={(goalId) => handleSetDcaGoal(fund, goalId)}
                setDcaEditId={setDcaEditId}
                setDcaEditValue={setDcaEditValue}
                setDcaEditIsNew={setDcaEditIsNew}
              />
            ))}
          </div>
        )}

        {/* NAV info banner */}
        {!loading && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', background: 'var(--c-navy-tint)', border: '1px solid var(--c-line)', borderRadius: 10, marginTop: 4 }}>
            <div style={{ width: 20, height: 20, borderRadius: 10, background: 'var(--c-accent-fund, #2563eb)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1, fontSize: 11, fontWeight: 700 }}>i</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-navy)', marginBottom: 2 }}>{t('navInfoTitle')}</div>
              <div style={{ fontSize: 11, color: 'var(--c-muted)', lineHeight: 1.5 }}>{t('navInfoDesc', { refreshNav: t('refreshNav') })}</div>
            </div>
          </div>
        )}
      </div>

      {/* Add sheet */}
      <Sheet open={addOpen} onClose={() => { setAddOpen(false); setFormError(null) }} testId="fund-sheet" ariaLabel={t('addModal')} dismissOnBackdrop={false}>
        <FundForm
          existing={null}
          title={t('addModal')}
          onClose={() => { setAddOpen(false); setFormError(null) }}
          onSave={(data) => handleSave(data)}
          saving={saving}
          formError={formError}
        />
      </Sheet>

      {/* Edit sheet */}
      <Sheet open={!!editFund} onClose={() => { setEditFund(null); setFormError(null) }} testId="fund-sheet" ariaLabel={t('editModal')} dismissOnBackdrop={false}>
        {editFund && (
          <FundForm
            existing={editFund}
            title={t('editModal')}
            onClose={() => { setEditFund(null); setFormError(null) }}
            onSave={(data) => handleSave(data, editFund.id)}
            saving={saving}
            formError={formError}
          />
        )}
      </Sheet>

      {/* Delete sheet */}
      <Sheet open={!!deleteFund} onClose={() => { if (!deleting) setDeleteFund(null) }} testId="delete-fund-sheet" ariaLabel={t('deleteModal', { name: deleteFund?.code ?? '' })}>
        {deleteFund && (
          <div style={{ paddingTop: 14, display: 'grid', gap: 14 }}>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 16, color: 'var(--c-ink)' }}>{t('deleteModal', { name: deleteFund.code })}</p>
            {/* Impact line — parity with desktop DeleteModal (#2 P2). */}
            <p style={{ margin: 0, fontSize: 13, color: 'var(--c-muted)', lineHeight: 1.5 }}>{t('deleteWarning', { name: deleteFund.code })} {t('deleteCannotUndo')}</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setDeleteFund(null)} disabled={deleting} style={{ flex: 1, padding: '10px 14px', fontSize: 13, fontWeight: 600, border: '1px solid var(--c-line)', borderRadius: 10, background: 'var(--c-card)', color: 'var(--c-ink)', cursor: 'pointer', fontFamily: 'inherit' }}>
                {tc('cancel')}
              </button>
              <button onClick={handleDelete} disabled={deleting} style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 14px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 10, background: 'var(--c-neg)', color: '#fff', cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.6 : 1, fontFamily: 'inherit' }}>
                <IconTrash size={14} color="#fff" />
                {deleting ? tc('deleting') : t('deleteBtn')}
              </button>
            </div>
          </div>
        )}
      </Sheet>


    </div>
  )
}
