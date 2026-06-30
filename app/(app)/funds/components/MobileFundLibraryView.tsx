'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Plus, RefreshCw, Search, X, ChevronDown, Check } from 'lucide-react'
import { useNavigation } from '@/app/components/navigation/NavigationContext'
import { Skeleton } from '@/app/components/ui/Skeleton'
import { SyncPill } from '@/app/components/ui/SyncPill'
import { fmtNav, fmtCompact } from '@/lib/formatters'
// Shared dialog a11y (Esc-to-close + focus trap + focus restore). Lives under
// the Plan feature today; reused here so Funds sheets behave the same.
import { useDialogA11y } from '@/app/(app)/planning/components/useDialogA11y'
import { FundsEmptyState } from './FundsEmptyState'
import { FundNavAge } from './FundNavAge'
import type { Fund, Goal, FundType, FundsData } from './useFundsData'

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

const TYPE_META: Record<FundType, { label: string; labelVi: string; color: string; bg: string }> = {
  equity:   { label: 'Stock',    labelVi: 'Cổ phiếu',   color: 'var(--c-fund-equity)',   bg: 'var(--c-fund-equity-bg)' },
  debt:     { label: 'Bond',     labelVi: 'Trái phiếu', color: 'var(--c-fund-debt)',     bg: 'var(--c-fund-debt-bg)' },
  balanced: { label: 'Balanced', labelVi: 'Cân bằng',   color: 'var(--c-fund-balanced)', bg: 'var(--c-fund-balanced-bg)' },
  gold:     { label: 'Gold',     labelVi: 'Vàng',       color: 'var(--c-fund-gold)',     bg: 'var(--c-fund-gold-bg)' },
}

const TYPE_FILTERS: Array<{ v: 'all' | FundType; label: string; labelVi: string }> = [
  { v: 'all',      label: 'All',      labelVi: 'Tất cả' },
  { v: 'equity',   label: 'Stock',    labelVi: 'Cổ phiếu' },
  { v: 'debt',     label: 'Bond',     labelVi: 'Trái phiếu' },
  { v: 'balanced', label: 'Balanced', labelVi: 'Cân bằng' },
]

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

const FORM_TYPES = (Object.keys(TYPE_META) as FundType[]).filter((ft) => ft !== 'gold')

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

function Sheet({ open, onClose, testId, dismissOnBackdrop = true, children }: { open: boolean; onClose: () => void; testId: string; dismissOnBackdrop?: boolean; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  useDialogA11y(sheetRef, open, onClose)
  useEffect(() => {
    if (open) setMounted(true)
    else { const t = setTimeout(() => setMounted(false), 220); return () => clearTimeout(t) }
  }, [open])
  if (!mounted) return null

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.3)', zIndex: 200, pointerEvents: open ? 'auto' : 'none', display: 'flex', alignItems: 'flex-end' }}
      // Form sheets opt out of backdrop dismissal so a stray tap doesn't discard
      // typed input; they're closed via the Cancel button (#2 P2).
      onClick={dismissOnBackdrop ? onClose : undefined}
    >
      <div
        ref={sheetRef}
        data-testid={testId}
        style={{ width: '100%', background: 'var(--c-card)', borderRadius: '16px 16px 0 0', paddingBottom: 'env(safe-area-inset-bottom,0)', animation: open ? 'slide-up 220ms cubic-bezier(0.2,0.8,0.2,1)' : 'slide-down 180ms ease forwards' }}
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
  name: string; code: string; fund_type: FundType; nav: number; nav_source_url: string | null
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
  const [navUrl, setNavUrl] = useState(existing?.nav_source_url ?? '')

  const disabled = !name.trim() || !code.trim() || !nav || Number(nav) <= 0 || saving

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
        <input type="number" value={nav} onChange={(e) => setNav(e.target.value)} min="0.01" step="0.01" placeholder={t('navPlaceholder')} style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums' }} />
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        <label style={labelStyle}>{t('navSourceLabel')}</label>
        <input type="url" value={navUrl} onChange={(e) => setNavUrl(e.target.value)} placeholder={t('navUrlPlaceholder')} style={inputStyle} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button onClick={onClose} disabled={saving} style={{ flex: 1, padding: '10px 14px', fontSize: 13, fontWeight: 600, border: '1px solid var(--c-line)', borderRadius: 10, background: 'var(--c-card)', color: 'var(--c-ink)', cursor: 'pointer', fontFamily: 'inherit' }}>
          {tc('cancel')}
        </button>
        <button
          onClick={() => onSave({ name: name.trim(), code: code.trim(), fund_type: type, nav: Number(nav), nav_source_url: navUrl.trim() || null })}
          disabled={disabled}
          style={{ flex: 2, padding: '10px 14px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 10, background: disabled ? 'var(--c-line)' : 'var(--c-navy)', color: disabled ? 'var(--c-muted)' : '#fff', cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
        >
          {saving ? tc('saving') : t('saveBtn')}
        </button>
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
          {fund.nav_source_url && fund.updated_at && (
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
                value={dcaEditValue ? Number(dcaEditValue).toLocaleString('en-US') : ''}
                onChange={(e) => setDcaEditValue(e.target.value.replace(/,/g, '').replace(/[^0-9]/g, ''))}
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
                onClick={() => { setDcaEditId(fund.id); setDcaEditValue(String(fund.dca_monthly_amount_vnd)); setDcaEditIsNew(false) }}
                style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', background: 'var(--c-navy-tint)', color: 'var(--c-navy)', border: '1px solid var(--c-navy-tint)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                {fmtCompact(fund.dca_monthly_amount_vnd)}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { setDcaEditId(fund.id); setDcaEditValue(''); setDcaEditIsNew(false) }}
                style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', background: 'var(--c-navy-tint)', color: 'var(--c-navy)', border: '1px solid var(--c-navy-tint)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}
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
                fontFamily: 'inherit', cursor: 'pointer', appearance: 'none', outline: 'none',
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

export default function MobileFundLibraryView({ funds, setFunds, goals, loading, error, reload }: FundsData) {
  const t = useTranslations('funds')
  const tc = useTranslations('common')
  const locale = useLocale()
  const { setMobileTopBar } = useNavigation()

  // ── Data ──────────────────────────────────────────────────────────────────
  // funds / goals / loading / error / reload come from FundLibraryClient (#10).
  const [refreshing, setRefreshing] = useState(false)

  // ── UI state ──────────────────────────────────────────────────────────────
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | FundType>('all')
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
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([])

  // ── Helpers ───────────────────────────────────────────────────────────────

  const addToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = ++toastSeq
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000)
  }, [])

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
            disabled={refreshing || !funds.some((f) => f.nav_source_url)}
            aria-label={t('refreshNav')}
            style={{ padding: 8, background: 'transparent', border: '1px solid var(--c-line)', borderRadius: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', opacity: refreshing || !funds.some((f) => f.nav_source_url) ? 0.4 : 1 }}
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

  const sortedFunds = useMemo(() => {
    let list = [...funds]
    if (filter !== 'all') list = list.filter((f) => f.fund_type === filter)
    if (query) {
      const q = query.toLowerCase()
      list = list.filter((f) => f.code.toLowerCase().includes(q) || f.name.toLowerCase().includes(q))
    }
    list.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'nav') cmp = a.nav - b.nav
      else if (sortKey === 'code') cmp = a.code.localeCompare(b.code)
      else cmp = a.name.localeCompare(b.name)
      return sortAsc ? cmp : -cmp
    })
    return list
  }, [funds, filter, query, sortKey, sortAsc])

  // ── Actions ───────────────────────────────────────────────────────────────

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((v) => !v)
    else { setSortKey(key); setSortAsc(true) }
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
      const res = await fetch(`/api/funds/${deleteFund.id}`, { method: 'DELETE' })
      // Hard-block: a fund used in a monthly plan can't be deleted (#1). Show a
      // specific, actionable message instead of the generic failure toast.
      if (res.status === 409) {
        setDeleteFund(null)
        addToast(t('toastDeleteInUse'), 'error')
        return
      }
      if (!res.ok && res.status !== 204) throw new Error()
      setDeleteFund(null)
      await reload()
      addToast(t('toastDeleted'))
    } catch {
      addToast(t('toastDeleteFailed'), 'error')
      setDeleteFund(null)
    } finally {
      setDeleting(false)
    }
  }

  async function handleToggleDca(fund: Fund) {
    const turningOn = !fund.is_dca
    setFunds((prev) => prev.map((f) => f.id === fund.id ? { ...f, is_dca: turningOn, dca_monthly_amount_vnd: turningOn ? f.dca_monthly_amount_vnd : null } : f))

    if (turningOn) {
      setDcaEditId(fund.id)
      setDcaEditValue('')
      setDcaEditIsNew(true)
      return
    }

    setTogglingIds((prev) => new Set([...prev, fund.id]))
    try {
      const res = await fetch(`/api/funds/${fund.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: fund.name, code: fund.code, fund_type: fund.fund_type, nav: fund.nav, nav_source_url: fund.nav_source_url, is_dca: false, dca_monthly_amount_vnd: null }) })
      if (!res.ok) throw new Error()
      await reload()
    } catch {
      setFunds((prev) => prev.map((f) => f.id === fund.id ? { ...f, is_dca: true } : f))
      addToast(t('toastDcaFailed'), 'error')
    } finally {
      setTogglingIds((prev) => { const s = new Set(prev); s.delete(fund.id); return s })
    }
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

    setDcaEditIsNew(false)
    setTogglingIds((prev) => new Set([...prev, fund.id]))
    try {
      const res = await fetch(`/api/funds/${fund.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: fund.name, code: fund.code, fund_type: fund.fund_type, nav: fund.nav, nav_source_url: fund.nav_source_url, is_dca: true, dca_monthly_amount_vnd: amount, dca_goal_id: fund.dca_goal_id }) })
      if (!res.ok) throw new Error()
      await reload()
    } catch {
      setFunds((prev) => prev.map((f) => f.id === fund.id ? { ...f, is_dca: false, dca_monthly_amount_vnd: null } : f))
      addToast(t('toastDcaFailed'), 'error')
    } finally {
      setTogglingIds((prev) => { const s = new Set(prev); s.delete(fund.id); return s })
    }
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
    const prevGoalId = fund.dca_goal_id
    setFunds((prev) => prev.map((f) => f.id === fund.id ? { ...f, dca_goal_id: goalId } : f))
    setTogglingIds((prev) => new Set([...prev, fund.id]))
    try {
      const res = await fetch(`/api/funds/${fund.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: fund.name, code: fund.code, fund_type: fund.fund_type, nav: fund.nav, nav_source_url: fund.nav_source_url, is_dca: true, dca_monthly_amount_vnd: fund.dca_monthly_amount_vnd, dca_goal_id: goalId }) })
      if (!res.ok) throw new Error()
      await reload()
    } catch {
      setFunds((prev) => prev.map((f) => f.id === fund.id ? { ...f, dca_goal_id: prevGoalId } : f))
      addToast(t('toastGoalFailed'), 'error')
    } finally {
      setTogglingIds((prev) => { const s = new Set(prev); s.delete(fund.id); return s })
    }
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
      <Sheet open={addOpen} onClose={() => { setAddOpen(false); setFormError(null) }} testId="fund-sheet" dismissOnBackdrop={false}>
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
      <Sheet open={!!editFund} onClose={() => { setEditFund(null); setFormError(null) }} testId="fund-sheet" dismissOnBackdrop={false}>
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
      <Sheet open={!!deleteFund} onClose={() => { if (!deleting) setDeleteFund(null) }} testId="delete-fund-sheet">
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
                {deleting ? tc('deleting') : tc('delete')}
              </button>
            </div>
          </div>
        )}
      </Sheet>


    </div>
  )
}
