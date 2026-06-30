'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Plus, RefreshCw, Search, X } from 'lucide-react'
import { fmtCompact, fmtNav } from '@/lib/formatters'
import { Skeleton } from '@/app/components/ui/Skeleton'
import { SyncPill } from '@/app/components/ui/SyncPill'
// Shared dialog a11y (Esc-to-close + focus trap + focus restore). Lives under
// the Plan feature today; reused here so Funds dialogs behave the same.
import { useDialogA11y } from '@/app/(app)/planning/components/useDialogA11y'
import { FundsEmptyState } from './FundsEmptyState'
import { FundNavAge } from './FundNavAge'
import type { Fund, Goal, FundType, FundsData } from './useFundsData'

// ─── Types ────────────────────────────────────────────────────────────────────
// Fund/Goal/FundType are shared with the mobile view via useFundsData.

type SortKey = 'code' | 'nav' | 'name'
type TypeFilter = 'all' | 'equity' | 'debt' | 'balanced'

// ─── Design constants ─────────────────────────────────────────────────────────

const TYPE_META: Record<FundType, { label: string; labelVi: string; color: string; bg: string }> = {
  equity:   { label: 'Stock',    labelVi: 'Cổ phiếu',   color: 'var(--c-fund-equity)',   bg: 'var(--c-fund-equity-bg)' },
  debt:     { label: 'Bond',     labelVi: 'Trái phiếu', color: 'var(--c-fund-debt)',     bg: 'var(--c-fund-debt-bg)' },
  balanced: { label: 'Balanced', labelVi: 'Cân bằng',   color: 'var(--c-fund-balanced)', bg: 'var(--c-fund-balanced-bg)' },
  gold:     { label: 'Gold',     labelVi: 'Vàng',       color: 'var(--c-fund-gold)',     bg: 'var(--c-fund-gold-bg)' },
}

const TYPE_FILTERS: { v: TypeFilter; label: string; labelVi: string }[] = [
  { v: 'all',      label: 'All',      labelVi: 'Tất cả' },
  { v: 'equity',   label: 'Stock',    labelVi: 'Cổ phiếu' },
  { v: 'debt',     label: 'Bond',     labelVi: 'Trái phiếu' },
  { v: 'balanced', label: 'Balanced', labelVi: 'Cân bằng' },
]

// Selectable fund types in the create/edit form. Gold is excluded (handled
// separately via byType) to match MobileFundLibraryView's FORM_TYPES.
const FORM_TYPES = (Object.keys(TYPE_META) as FundType[]).filter(ft => ft !== 'gold')

// ─── Small components ─────────────────────────────────────────────────────────

const TypeChip = ({ type }: { type: FundType }) => {
  const m = TYPE_META[type]
  const locale = useLocale()
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      fontSize: 10, fontWeight: 600, letterSpacing: '0.03em',
      padding: '2px 7px', borderRadius: 999,
      background: m.bg, color: m.color,
    }}>
      {locale === 'vi' ? m.labelVi : m.label}
    </span>
  )
}

const FundIcon = ({ code, type, size = 32 }: { code: string; type: FundType; size?: number }) => {
  const m = TYPE_META[type]
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.25,
      flexShrink: 0, background: m.bg, color: m.color,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.34, fontWeight: 700, fontFamily: 'var(--font-mono, monospace)',
    }}>
      {code.slice(0, 2)}
    </div>
  )
}

// ─── DModal ───────────────────────────────────────────────────────────────────

function DModal({ open, onClose, title, width = 460, dismissOnBackdrop = true, children }: {
  open: boolean; onClose: () => void; title: string; width?: number; dismissOnBackdrop?: boolean; children: ReactNode
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogA11y(dialogRef, open, onClose)
  if (!open) return null
  return (
    <div
      // Form modals opt out of backdrop dismissal so a stray click doesn't
      // discard typed input; they're closed via Cancel or the X (#2 P2).
      onClick={dismissOnBackdrop ? onClose : undefined}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, backdropFilter: 'blur(2px)', animation: 'fade-in 150ms ease' }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        data-testid="fund-modal"
        onClick={e => e.stopPropagation()}
        style={{ width, maxWidth: '100%', background: 'var(--c-card)', borderRadius: 'var(--r-card)', boxShadow: '0 20px 60px rgba(0,0,0,0.18)', animation: 'pop-in 180ms ease', overflow: 'hidden' }}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--c-line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span data-testid="fund-modal-title" style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
          <button onClick={onClose} className="cn-btn ghost" style={{ padding: 6 }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ padding: '20px' }}>{children}</div>
      </div>
    </div>
  )
}

function DeleteModal({ open, onClose, fundCode, onConfirm, deleting }: {
  open: boolean; onClose: () => void; fundCode: string; onConfirm: () => void; deleting: boolean
}) {
  const t = useTranslations('funds')
  const tc = useTranslations('common')
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogA11y(dialogRef, open, onClose)
  if (!open) return null
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, backdropFilter: 'blur(2px)', animation: 'fade-in 150ms ease' }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        data-testid="delete-fund-modal"
        onClick={e => e.stopPropagation()}
        style={{ width: 400, maxWidth: '100%', background: 'var(--c-card)', borderRadius: 'var(--r-card)', boxShadow: '0 20px 60px rgba(0,0,0,0.18)', animation: 'pop-in 180ms ease', overflow: 'hidden' }}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--c-line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{t('deleteModal', { name: fundCode })}</span>
          <button onClick={onClose} className="cn-btn ghost" style={{ padding: 6 }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ padding: '20px', display: 'grid', gap: 16 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--c-muted)', lineHeight: 1.5 }}>
            {t('deleteWarning', { name: fundCode })} {t('deleteCannotUndo')}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} className="cn-btn" style={{ flex: 1, justifyContent: 'center' }} disabled={deleting}>
              {tc('cancel')}
            </button>
            <button
              onClick={onConfirm}
              disabled={deleting}
              style={{ flex: 2, padding: '10px 14px', background: 'var(--c-neg)', color: '#fff', border: 'none', borderRadius: 'var(--r-control)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: deleting ? 0.5 : 1 }}
            >
              {deleting ? tc('deleting') : t('deleteBtn')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Sort header ──────────────────────────────────────────────────────────────

const SortTh = ({ label, sortKey, active, asc, onSort, align = 'right' }: {
  label: string; sortKey: SortKey; active: boolean; asc: boolean; onSort: (k: SortKey) => void; align?: 'left' | 'right'
}) => (
  // The clickable sort target is a real <button> (not a bare th onClick) so it's
  // keyboard-focusable + Enter/Space-activatable; aria-sort exposes state to AT.
  <th
    aria-sort={active ? (asc ? 'ascending' : 'descending') : 'none'}
    style={{ padding: 0, whiteSpace: 'nowrap' }}
  >
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      style={{
        width: '100%', textAlign: align,
        padding: '10px 12px', background: 'none', border: 'none',
        fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
        color: active ? 'var(--c-navy)' : 'var(--c-muted)',
        cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
        fontFamily: 'inherit',
      }}
    >
      {label} {active ? (asc ? '↑' : '↓') : ''}
    </button>
  </th>
)

// ─── DCA toggle (inline) ──────────────────────────────────────────────────────

function DcaToggle({ fund, editId, editValue, toggling, goals, goalLabel, unallocatedLabel, onToggle, onEditStart, onEditChange, onEditCommit, onEditCancel, onGoalChange }: {
  fund: Fund
  editId: string | null
  editValue: string
  toggling: boolean
  goals: Goal[]
  goalLabel: string
  unallocatedLabel: string
  onToggle: () => void
  onEditStart: () => void
  onEditChange: (v: string) => void
  onEditCommit: () => void
  onEditCancel: () => void
  onGoalChange: (goalId: string | null) => void
}) {
  const t = useTranslations('funds')
  const tc = useTranslations('common')
  const isEditing = editId === fund.id
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
      <button
        data-testid="dca-toggle"
        aria-label={fund.is_dca ? t('disableDca') : t('enableDca')}
        disabled={toggling}
        onClick={e => { e.stopPropagation(); onToggle() }}
        style={{
          width: 34, height: 19, borderRadius: 999,
          background: fund.is_dca ? 'var(--c-btn-primary)' : 'var(--c-line-strong)',
          border: 'none', cursor: toggling ? 'not-allowed' : 'pointer', position: 'relative',
          transition: 'background 180ms', flexShrink: 0, opacity: toggling ? 0.5 : 1,
        }}
      >
        <span style={{
          position: 'absolute', top: 2,
          left: fund.is_dca ? 17 : 2, width: 15, height: 15, borderRadius: 999,
          background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          transition: 'left 180ms',
        }} />
      </button>
      {fund.is_dca && (
        isEditing ? (
          <input
            autoFocus
            data-testid={`dca-amount-input-${fund.id}`}
            type="text"
            inputMode="numeric"
            placeholder={tc('amount')}
            value={editValue ? Number(editValue).toLocaleString('en-US') : ''}
            onChange={e => onEditChange(e.target.value.replace(/,/g, '').replace(/[^0-9]/g, ''))}
            onBlur={onEditCommit}
            onKeyDown={e => {
              if (e.key === 'Enter') onEditCommit()
              if (e.key === 'Escape') onEditCancel()
            }}
            onClick={e => e.stopPropagation()}
            style={{
              width: 100, padding: '3px 8px', fontSize: 11,
              border: '1px solid var(--c-navy)', borderRadius: 6,
              background: 'var(--c-card)', fontFamily: 'inherit',
              outline: 'none', color: 'var(--c-ink)',
            }}
          />
        ) : (
          <button
            data-testid={`dca-amount-btn-${fund.id}`}
            onClick={e => { e.stopPropagation(); onEditStart() }}
            style={{
              fontSize: 11, fontWeight: 500, padding: '2px 8px',
              background: 'var(--c-navy-tint)', color: 'var(--c-navy)',
              border: '1px solid var(--c-navy-tint)', borderRadius: 6,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {fund.dca_monthly_amount_vnd ? fmtCompact(fund.dca_monthly_amount_vnd) : t('setAmount')}
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
          disabled={toggling}
          onClick={e => e.stopPropagation()}
          onChange={e => { e.stopPropagation(); onGoalChange(e.target.value || null) }}
          style={{
            fontSize: 11, fontWeight: 500, padding: '3px 6px', maxWidth: 120,
            border: '1px solid var(--c-line)', borderRadius: 6,
            // --c-ink-2 (not --c-muted): the select holds a real chosen goal, so
            // it needs readable contrast, not faint placeholder-grey.
            background: 'var(--c-card)', color: 'var(--c-ink-2)',
            fontFamily: 'inherit', cursor: 'pointer', appearance: 'none', outline: 'none',
          }}
        >
          {goals.map(g => <option key={g.goal_id} value={g.goal_id}>{g.goal_name}</option>)}
          <option value="">{unallocatedLabel}</option>
        </select>
      )}
    </div>
  )
}

// ─── Form field helper ────────────────────────────────────────────────────────

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 5 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-ink-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</label>
      {children}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DesktopFundLibraryView({ funds, setFunds, goals, loading, error, reload }: FundsData) {
  const t = useTranslations('funds')
  const tc = useTranslations('common')
  const locale = useLocale()

  // funds / goals / loading / error / reload come from FundLibraryClient (#10).

  // Table state
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('code')
  const [sortAsc, setSortAsc] = useState(true)

  // DCA inline edit
  const [dcaEditId, setDcaEditId] = useState<string | null>(null)
  const [dcaEditValue, setDcaEditValue] = useState('')
  // True only while editing a DCA that was *just* toggled on and never persisted.
  // Distinguishes "cancel a brand-new enable" (revert to off) from "clear an
  // already-saved amount" (a no-op cancel — the server still has DCA on, so
  // flipping the local row off would desync until the next reload) (#2).
  const [dcaEditIsNew, setDcaEditIsNew] = useState(false)
  // Funds with an in-flight DCA PUT — toggle/goal-select disabled until it lands
  // (parity with mobile's togglingIds, prevents overlapping PUTs on fast clicks).
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())

  // Modals
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null)
  const [editTarget, setEditTarget] = useState<Fund | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Fund | null>(null)
  const [formName, setFormName] = useState('')
  const [formCode, setFormCode] = useState('')
  const [formType, setFormType] = useState<FundType | ''>('')
  const [formNav, setFormNav] = useState('')
  const [formNavUrl, setFormNavUrl] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // Toast
  const [toasts, setToasts] = useState<{ id: number; msg: string; ok: boolean }[]>([])
  const toastIdRef = useRef(0)
  const addToast = useCallback((msg: string, ok = true) => {
    const id = ++toastIdRef.current
    setToasts(p => [...p, { id, msg, ok }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3000)
  }, [])

  // Sorting
  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(a => !a)
    else { setSortKey(key); setSortAsc(true) }
  }

  // Filtered + sorted funds
  const displayFunds = useMemo(() => {
    let f = funds
    if (typeFilter !== 'all') f = f.filter(x => x.fund_type === typeFilter)
    if (query) {
      const q = query.toLowerCase()
      f = f.filter(x => x.code.toLowerCase().includes(q) || x.name.toLowerCase().includes(q))
    }
    return [...f].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'nav') cmp = a.nav - b.nav
      else cmp = a[sortKey].localeCompare(b[sortKey])
      return sortAsc ? cmp : -cmp
    })
  }, [funds, typeFilter, query, sortKey, sortAsc])

  // Refresh NAV
  async function handleRefreshNav() {
    setRefreshing(true)
    try {
      const res = await fetch('/api/v1/funds/refresh-nav', { method: 'POST' })
      const { results } = await res.json()
      const updated = results.filter((r: { nav?: number }) => r.nav !== undefined).length
      const failed = results.filter((r: { error?: string }) => r.error).length
      await reload()
      addToast(t('navRefreshDone', { updated, failed }), failed === 0 || updated > 0)
    } catch {
      addToast(t('toastRefreshFailed'), false)
    } finally {
      setRefreshing(false)
    }
  }

  // Add/Edit modal open
  function openAddModal() {
    setFormName(''); setFormCode(''); setFormType('equity'); setFormNav(''); setFormNavUrl(''); setFormError(null); setEditTarget(null); setModalMode('add')
  }
  function openEditModal(fund: Fund, e?: { stopPropagation: () => void }) {
    e?.stopPropagation()
    setFormName(fund.name); setFormCode(fund.code); setFormType(fund.fund_type); setFormNav(String(fund.nav)); setFormNavUrl(fund.nav_source_url ?? ''); setFormError(null); setEditTarget(fund); setModalMode('edit')
  }
  function closeModal() { setModalMode(null); setEditTarget(null); setFormError(null) }

  async function handleSave() {
    setFormError(null)
    if (!formName.trim()) { setFormError(t('nameRequired')); return }
    if (!formCode.trim()) { setFormError(t('codeRequired')); return }
    if (!formType) { setFormError(t('typeRequired')); return }
    const navNum = Number(formNav)
    if (!formNav || isNaN(navNum) || navNum < 0.01) { setFormError(t('navRequired')); return }
    setSaving(true)
    try {
      const url = modalMode === 'edit' ? `/api/funds/${editTarget!.id}` : '/api/funds'
      const method = modalMode === 'edit' ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formName.trim(), code: formCode.trim(), fund_type: formType, nav: navNum, nav_source_url: formNavUrl.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) { setFormError(res.status === 409 ? t('codeExists') : data.error || t('error')); return }
      closeModal()
      await reload()
      addToast(modalMode === 'edit' ? t('toastUpdated') : t('toastAdded'))
    } catch {
      setFormError(t('error'))
    } finally {
      setSaving(false)
    }
  }

  // DCA
  async function handleToggleDca(fund: Fund) {
    const turningOn = !fund.is_dca
    setFunds(p => p.map(f => f.id === fund.id ? { ...f, is_dca: turningOn, dca_monthly_amount_vnd: turningOn ? f.dca_monthly_amount_vnd : null } : f))

    if (turningOn) {
      setDcaEditId(fund.id)
      setDcaEditValue('')
      setDcaEditIsNew(true)
      return
    }

    setTogglingIds(p => new Set(p).add(fund.id))
    try {
      const res = await fetch(`/api/funds/${fund.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fund.name, code: fund.code, fund_type: fund.fund_type, nav: fund.nav, nav_source_url: fund.nav_source_url, is_dca: false, dca_monthly_amount_vnd: null }),
      })
      if (!res.ok) throw new Error()
      await reload()
    } catch {
      setFunds(p => p.map(f => f.id === fund.id ? { ...f, is_dca: true } : f))
      addToast(t('toastDcaFailed'), false)
    } finally {
      setTogglingIds(p => { const s = new Set(p); s.delete(fund.id); return s })
    }
  }

  async function handleSaveDcaAmount(fund: Fund) {
    const amount = Number(dcaEditValue)
    const valid = dcaEditValue !== '' && !isNaN(amount) && amount > 0
    if (!valid) {
      // Only a brand-new, never-persisted enable reverts to off. Clearing an
      // already-saved amount is a no-op cancel; the saved row stays as the
      // server has it (#2). Turning DCA off is done via the toggle.
      if (dcaEditIsNew) {
        setFunds(p => p.map(f => f.id === fund.id ? { ...f, is_dca: false, dca_monthly_amount_vnd: null } : f))
      }
      setDcaEditId(null)
      setDcaEditIsNew(false)
      return
    }
    setDcaEditId(null)
    setDcaEditIsNew(false)
    setTogglingIds(p => new Set(p).add(fund.id))
    try {
      const res = await fetch(`/api/funds/${fund.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fund.name, code: fund.code, fund_type: fund.fund_type, nav: fund.nav, nav_source_url: fund.nav_source_url, is_dca: true, dca_monthly_amount_vnd: amount, dca_goal_id: fund.dca_goal_id }),
      })
      if (!res.ok) throw new Error()
      await reload()
    } catch {
      setFunds(p => p.map(f => f.id === fund.id ? { ...f, is_dca: false, dca_monthly_amount_vnd: null } : f))
      addToast(t('toastDcaFailed'), false)
    } finally {
      setTogglingIds(p => { const s = new Set(p); s.delete(fund.id); return s })
    }
  }

  async function handleSetDcaGoal(fund: Fund, goalId: string | null) {
    const prevGoalId = fund.dca_goal_id
    setFunds(p => p.map(f => f.id === fund.id ? { ...f, dca_goal_id: goalId } : f))
    setTogglingIds(p => new Set(p).add(fund.id))
    try {
      const res = await fetch(`/api/funds/${fund.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fund.name, code: fund.code, fund_type: fund.fund_type, nav: fund.nav, nav_source_url: fund.nav_source_url, is_dca: true, dca_monthly_amount_vnd: fund.dca_monthly_amount_vnd, dca_goal_id: goalId }),
      })
      if (!res.ok) throw new Error()
      await reload()
    } catch {
      setFunds(p => p.map(f => f.id === fund.id ? { ...f, dca_goal_id: prevGoalId } : f))
      addToast(t('toastGoalFailed'), false)
    } finally {
      setTogglingIds(p => { const s = new Set(p); s.delete(fund.id); return s })
    }
  }

  // Delete
  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/funds/${deleteTarget.id}`, { method: 'DELETE' })
      // Hard-block: a fund used in a monthly plan can't be deleted (#1). Show a
      // specific, actionable message instead of the generic failure toast.
      if (res.status === 409) {
        setDeleteTarget(null)
        addToast(t('toastDeleteInUse'), false)
        return
      }
      if (!res.ok && res.status !== 204) throw new Error()
      setDeleteTarget(null)
      await reload()
      addToast(t('toastDeleted'))
    } catch {
      addToast(t('toastDeleteFailed'), false)
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div data-testid="desktop-funds" className="hidden md:flex" style={{ flex: 1, minHeight: 0, overflow: 'hidden', flexDirection: 'column' }}>
      {/* Background-sync pill while NAV prices refresh */}
      <SyncPill label={t('syncingPrices')} show={refreshing} />

      {/* Toast notifications */}
      <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 300, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {toasts.map(t => (
          <div key={t.id} style={{ padding: '8px 16px', borderRadius: 10, background: t.ok ? 'var(--c-pos)' : 'var(--c-neg)', color: '#fff', fontSize: 13, fontWeight: 500, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', animation: 'pop-in 200ms ease' }}>
            {t.msg}
          </div>
        ))}
      </div>

      {/* ─── Page header ────────────────────────────────────────────────────── */}
      <div style={{ padding: '20px 28px 16px', borderBottom: '1px solid var(--c-line)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--c-canvas)' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-muted)', marginBottom: 3 }}>
            {t('pageSubtitle')}
          </div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1, color: 'var(--c-ink)' }}>
            {t('pageTitle')}
          </h1>
        </div>
      </div>

      {/* ─── Two-panel area ─────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>

      {/* ─── Main panel ─────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, padding: '20px 24px 40px', minWidth: 0, overflowY: 'auto' }}>

        {/* Toolbar */}
        <div data-testid="desktop-funds-toolbar" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          {/* Search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 10, flex: '1 1 200px', minWidth: 160 }}>
            <Search size={15} color="var(--c-muted)" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: 'var(--c-ink)', fontFamily: 'inherit' }}
            />
            {query && (
              <button onClick={() => setQuery('')} className="cn-btn ghost" style={{ padding: 3 }}>
                <X size={13} />
              </button>
            )}
          </div>

          {/* Type filter pills */}
          <div style={{ display: 'flex', gap: 5 }}>
            {TYPE_FILTERS.map(f => (
              <button
                key={f.v}
                onClick={() => setTypeFilter(f.v)}
                style={{
                  padding: '6px 12px', borderRadius: 999, fontSize: 11, fontWeight: 500,
                  background: typeFilter === f.v ? 'var(--c-ink)' : 'var(--c-card)',
                  color: typeFilter === f.v ? 'var(--c-card)' : 'var(--c-muted)',
                  border: '1px solid ' + (typeFilter === f.v ? 'var(--c-ink)' : 'var(--c-line)'),
                  cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                  transition: 'all 120ms',
                }}
              >
                {locale === 'vi' ? f.labelVi : f.label}
              </button>
            ))}
          </div>

          {/* Actions */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button
              onClick={handleRefreshNav}
              disabled={refreshing || !funds.some(f => f.nav_source_url)}
              title={funds.some(f => f.nav_source_url) ? undefined : t('refreshDisabledHint')}
              className="cn-btn ghost"
              style={{ padding: '7px 10px', gap: 5, fontSize: 12, display: 'flex', alignItems: 'center' }}
            >
              <RefreshCw size={15} />
              {tc('refresh')}
            </button>
            <button
              onClick={openAddModal}
              className="cn-btn primary"
              style={{ padding: '7px 14px', fontSize: 12, gap: 5, display: 'flex', alignItems: 'center' }}
            >
              <Plus size={13} strokeWidth={2.4} />
              {t('add')}
            </button>
          </div>
        </div>

        {/* Fund count */}
        <div style={{ fontSize: 12, color: 'var(--c-muted)', marginBottom: 10 }}>
          {t('fundsCount', { count: displayFunds.length })}
        </div>

        {/* Table or states */}
        {loading ? (
          <div className="cn-card" style={{ overflow: 'hidden' }} data-testid="funds-loading-skeleton">
            {[...Array(4)].map((_, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: i < 3 ? '1px solid var(--c-line)' : 'none' }}>
                <Skeleton width={32} height={32} style={{ borderRadius: 8, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <Skeleton width={120} height={12} style={{ marginBottom: 6 }} />
                  <Skeleton width={80} height={10} />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="cn-card" style={{ padding: 48, textAlign: 'center' }}>
            <p style={{ color: 'var(--c-neg)', marginBottom: 16, fontSize: 14 }}>{t('loadError')}</p>
            <button onClick={() => reload()} className="cn-btn primary" style={{ padding: '8px 20px' }}>{tc('tryAgain')}</button>
          </div>
        ) : funds.length === 0 ? (
          <div className="cn-card" style={{ padding: 64 }}>
            <FundsEmptyState onAdd={openAddModal} />
          </div>
        ) : (
          <div className="cn-card" style={{ overflow: 'hidden' }} data-testid="desktop-funds-table">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--c-line)', background: 'var(--c-card-2)' }}>
                  <SortTh label={t('colFund')} sortKey="code" active={sortKey === 'code'} asc={sortAsc} onSort={handleSort} align="left" />
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-muted)', whiteSpace: 'nowrap' }}>{t('colType')}</th>
                  <SortTh label={t('colNav')} sortKey="nav" active={sortKey === 'nav'} asc={sortAsc} onSort={handleSort} />
                  <th style={{ padding: '10px 12px', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-muted)', textAlign: 'center', whiteSpace: 'nowrap' }}>{t('colDca')}</th>
                  <th style={{ padding: '10px 12px', width: 64 }} />
                </tr>
              </thead>
              <tbody>
                {displayFunds.map((fund, i) => (
                    <tr
                      key={fund.id}
                      data-testid={`fund-row-${fund.id}`}
                      style={{
                        borderBottom: i < displayFunds.length - 1 ? '1px solid var(--c-line)' : 'none',
                        transition: 'background 100ms',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--c-card-2)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                    >
                      {/* Fund cell */}
                      <td style={{ padding: '13px 12px 13px 16px', verticalAlign: 'middle' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <FundIcon code={fund.code} type={fund.fund_type} size={32} />
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-mono, monospace)', color: 'var(--c-ink)' }}>
                              {fund.code}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 1, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {fund.name}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Type chip */}
                      <td style={{ padding: '13px 12px', verticalAlign: 'middle' }}>
                        <TypeChip type={fund.fund_type} />
                      </td>

                      {/* NAV */}
                      <td style={{ padding: '13px 12px', textAlign: 'right', verticalAlign: 'middle' }}>
                        <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                          {fmtNav(fund.nav)}
                        </span>
                        {fund.nav_source_url && fund.updated_at && (
                          <FundNavAge isoStr={fund.updated_at} style={{ fontSize: 10, color: 'var(--c-muted)', marginTop: 2 }} />
                        )}
                      </td>

                      {/* DCA */}
                      <td style={{ padding: '13px 12px', textAlign: 'center', verticalAlign: 'middle' }}>
                        <DcaToggle
                          fund={fund}
                          editId={dcaEditId}
                          editValue={dcaEditValue}
                          toggling={togglingIds.has(fund.id)}
                          goals={goals}
                          goalLabel={t('dcaGoalLabel')}
                          unallocatedLabel={t('dcaGoalUnallocated')}
                          onToggle={() => handleToggleDca(fund)}
                          onEditStart={() => { setDcaEditId(fund.id); setDcaEditValue(String(fund.dca_monthly_amount_vnd ?? '')); setDcaEditIsNew(false) }}
                          onEditChange={setDcaEditValue}
                          onEditCommit={() => handleSaveDcaAmount(fund)}
                          onEditCancel={() => { if (dcaEditIsNew) setFunds(p => p.map(f => f.id === fund.id ? { ...f, is_dca: false, dca_monthly_amount_vnd: null } : f)); setDcaEditId(null); setDcaEditIsNew(false) }}
                          onGoalChange={(goalId) => handleSetDcaGoal(fund, goalId)}
                        />
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '13px 8px 13px 4px', textAlign: 'right', verticalAlign: 'middle' }}>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                          <button
                            data-testid="fund-edit-btn"
                            onClick={e => openEditModal(fund, e)}
                            className="cn-btn ghost"
                            style={{ padding: 6 }}
                            aria-label={t('editFund')}
                          >
                            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="var(--c-muted)" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                              <path d="M4 20h4l10-10-4-4L4 16z" />
                            </svg>
                          </button>
                          <button
                            data-testid="fund-delete-btn"
                            onClick={e => { e.stopPropagation(); setDeleteTarget(fund) }}
                            className="cn-btn ghost"
                            style={{ padding: 6 }}
                            aria-label={t('deleteBtn')}
                          >
                            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="var(--c-neg)" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                ))}
              </tbody>
            </table>

            {displayFunds.length === 0 && (query || typeFilter !== 'all') && (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--c-muted)', fontSize: 13 }}>
                {t('noMatch')}
              </div>
            )}
          </div>
        )}

        {/* NAV info banner */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', background: 'var(--c-navy-tint)', border: '1px solid var(--c-line)', borderRadius: 10, marginTop: 16 }}>
          <div style={{ width: 18, height: 18, borderRadius: 9, background: 'var(--c-accent-fund, #2563eb)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1, fontSize: 10, fontWeight: 700 }}>i</div>
          <div style={{ fontSize: 12, color: 'var(--c-muted)', lineHeight: 1.5 }}>
            <span style={{ fontWeight: 600, color: 'var(--c-navy)' }}>{t('navInfoTitle')}: </span>
            {t('navInfoDesc', { refreshNav: t('refreshNav') })}
          </div>
        </div>
      </div>

      </div>{/* end main panel area */}

      {/* ─── Add/Edit Modal ──────────────────────────────────────────────────── */}
      <DModal
        open={!!modalMode}
        onClose={closeModal}
        dismissOnBackdrop={false}
        title={modalMode === 'edit' ? t('editModal') : t('addModal')}
        width={460}
      >
        <form onSubmit={e => { e.preventDefault(); handleSave() }}>
          <div style={{ display: 'grid', gap: 14 }}>
            {formError && (
              <div style={{ padding: '10px 12px', background: 'var(--c-neg-tint)', border: '1px solid var(--c-neg)', borderRadius: 8, fontSize: 12, color: 'var(--c-neg)' }}>
                {formError}
              </div>
            )}
            <FormField label={t('nameLabel')}>
              <input
                value={formName}
                onChange={e => setFormName(e.target.value)}
                className="cn-input"
                placeholder={t('namePlaceholder')}
                autoFocus
                maxLength={255}
              />
            </FormField>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <FormField label={t('codeLabel')}>
                <input
                  value={formCode}
                  onChange={e => setFormCode(e.target.value.toUpperCase())}
                  className="cn-input"
                  placeholder={t('codePlaceholder')}
                  maxLength={50}
                  style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 13 }}
                />
              </FormField>
              <FormField label={t('typeLabel')}>
                <select
                  value={formType}
                  onChange={e => setFormType(e.target.value as FundType)}
                  className="cn-input"
                >
                  {FORM_TYPES.map(v => (
                    <option key={v} value={v}>{locale === 'vi' ? TYPE_META[v].labelVi : TYPE_META[v].label}</option>
                  ))}
                </select>
              </FormField>
            </div>
            <FormField label={t('navLabel')}>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={formNav}
                onChange={e => setFormNav(e.target.value)}
                className="cn-input"
                style={{ fontVariantNumeric: 'tabular-nums' }}
                placeholder={t('navPlaceholder')}
              />
            </FormField>
            <FormField label={t('navSourceLabel')}>
              <input
                type="url"
                value={formNavUrl}
                onChange={e => setFormNavUrl(e.target.value)}
                className="cn-input"
                placeholder={t('navUrlPlaceholder')}
              />
            </FormField>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button type="button" onClick={closeModal} className="cn-btn ghost" style={{ flex: 1, justifyContent: 'center', border: '1px solid var(--c-line)' }} disabled={saving}>
                {tc('cancel')}
              </button>
              <button type="submit" className="cn-btn primary" style={{ flex: 2, justifyContent: 'center' }} disabled={saving}>
                {saving ? tc('saving') : modalMode === 'edit' ? t('saveBtn') : t('add')}
              </button>
            </div>
          </div>
        </form>
      </DModal>

      {/* ─── Delete Modal ────────────────────────────────────────────────────── */}
      <DeleteModal
        open={!!deleteTarget}
        onClose={() => { if (!deleting) setDeleteTarget(null) }}
        fundCode={deleteTarget?.code ?? ''}
        onConfirm={handleDelete}
        deleting={deleting}
      />
    </div>
  )
}
