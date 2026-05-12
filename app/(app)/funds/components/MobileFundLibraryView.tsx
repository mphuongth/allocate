'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Plus, RefreshCw, Search, X, Edit2, Trash2 } from 'lucide-react'
import MobileTopBar from '@/app/components/navigation/MobileTopBar'

// ─── Types ───────────────────────────────────────────────────────────────────

type FundType = 'balanced' | 'equity' | 'debt' | 'gold'

type Fund = {
  id: string
  name: string
  code: string
  fund_type: FundType
  nav: number
  nav_source_url: string | null
  is_dca: boolean
  dca_monthly_amount_vnd: number | null
  created_at: string
  updated_at: string
}

type Toast = { id: number; message: string; type: 'success' | 'error' }
type SortKey = 'code' | 'nav' | 'name'

// ─── Constants ───────────────────────────────────────────────────────────────

const CACHE_KEY = 'fundLibraryCache'
const CACHE_TTL = 2 * 60 * 1000

function getCache(): Fund[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { data, ts } = JSON.parse(raw)
    if (Date.now() - ts > CACHE_TTL) return null
    return data
  } catch { return null }
}

function setCache(data: Fund[]) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() })) } catch {}
}

function bustCache() {
  try { localStorage.removeItem(CACHE_KEY) } catch {}
}

const TYPE_META: Record<FundType, { label: string; color: string; bg: string }> = {
  equity:   { label: 'Stock',    color: '#16a34a', bg: '#f0fdf4' },
  debt:     { label: 'Bond',     color: '#2563eb', bg: '#eff6ff' },
  balanced: { label: 'Balanced', color: '#7c3aed', bg: '#f5f3ff' },
  gold:     { label: 'Gold',     color: '#b45309', bg: '#fef7e6' },
}

const TYPE_FILTERS: Array<{ v: 'all' | FundType; l: string }> = [
  { v: 'all',      l: 'All' },
  { v: 'equity',   l: 'Stock' },
  { v: 'debt',     l: 'Bond' },
  { v: 'balanced', l: 'Balanced' },
  { v: 'gold',     l: 'Gold' },
]

const SORT_OPTIONS: Array<{ v: SortKey; l: string }> = [
  { v: 'code', l: 'Code' },
  { v: 'nav',  l: 'NAV' },
  { v: 'name', l: 'Name' },
]

let toastSeq = 0

// ─── Sheet ───────────────────────────────────────────────────────────────────

function Sheet({ open, onClose, testId, children }: { open: boolean; onClose: () => void; testId: string; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    if (open) setMounted(true)
    else { const t = setTimeout(() => setMounted(false), 220); return () => clearTimeout(t) }
  }, [open])
  if (!mounted) return null

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.3)', zIndex: 200, pointerEvents: open ? 'auto' : 'none', display: 'flex', alignItems: 'flex-end' }}
      onClick={onClose}
    >
      <div
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
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 10, fontWeight: 600, letterSpacing: '0.03em', padding: '2px 7px', borderRadius: 999, background: m.bg, color: m.color }}>
      {m.label}
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

  const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', fontSize: 13, border: '1px solid var(--c-line)', borderRadius: 10, background: 'var(--c-card)', color: 'var(--c-ink)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }
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
        <label style={labelStyle}>{t('nameLabel')} <span style={{ color: 'var(--c-neg)' }}>*</span></label>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={255} placeholder="e.g., Vanguard S&P 500 ETF" style={inputStyle} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={{ display: 'grid', gap: 6 }}>
          <label style={labelStyle}>{t('codeLabel')} <span style={{ color: 'var(--c-neg)' }}>*</span></label>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={50} placeholder="e.g., VOO" style={{ ...inputStyle, fontFamily: 'var(--font-mono,monospace)' }} />
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          <label style={labelStyle}>{t('typeLabel')} <span style={{ color: 'var(--c-neg)' }}>*</span></label>
          <select value={type} onChange={(e) => setType(e.target.value as FundType)} style={inputStyle}>
            {(Object.keys(TYPE_META) as FundType[]).map((ft) => (
              <option key={ft} value={ft}>{TYPE_META[ft].label}</option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        <label style={labelStyle}>{t('navLabel')} <span style={{ color: 'var(--c-neg)' }}>*</span></label>
        <input type="number" value={nav} onChange={(e) => setNav(e.target.value)} min="0.01" step="0.01" placeholder="e.g., 450.25" style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums' }} />
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        <label style={labelStyle}>{t('navSourceLabel')}</label>
        <input type="url" value={navUrl} onChange={(e) => setNavUrl(e.target.value)} placeholder="https://..." style={inputStyle} />
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

function FundCard({ fund, dcaEditId, dcaEditValue, togglingIds, onEdit, onDelete, onToggleDca, onSaveDcaAmount, setDcaEditId, setDcaEditValue }: {
  fund: Fund
  dcaEditId: string | null
  dcaEditValue: string
  togglingIds: Set<string>
  onEdit: () => void
  onDelete: () => void
  onToggleDca: () => void
  onSaveDcaAmount: (val: string) => void
  setDcaEditId: (id: string | null) => void
  setDcaEditValue: (v: string) => void
}) {
  const m = TYPE_META[fund.fund_type]
  const isEditing = dcaEditId === fund.id
  const toggling = togglingIds.has(fund.id)

  function relDate(str: string) {
    const diff = Date.now() - new Date(str).getTime()
    const m = Math.floor(diff / 60000)
    if (m < 1) return 'just now'
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
  }

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
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <button onClick={onEdit} aria-label="Edit fund" style={{ padding: 6, background: 'transparent', border: '1px solid var(--c-line)', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <Edit2 size={14} color="var(--c-muted)" />
          </button>
          <button onClick={onDelete} aria-label="Delete fund" style={{ padding: 6, background: 'transparent', border: '1px solid var(--c-line)', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <Trash2 size={14} color="var(--c-neg)" />
          </button>
        </div>
      </div>

      {/* Row 2: NAV + DCA */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid var(--c-line)', gap: 8 }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--c-muted)', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>NAV</div>
          <div style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {fund.nav.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} VND
          </div>
          {fund.nav_source_url && fund.updated_at && (
            <div style={{ fontSize: 10, color: 'var(--c-muted)', marginTop: 1 }}>Updated {relDate(fund.updated_at)}</div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 10, color: 'var(--c-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>DCA</span>
          <button
            type="button"
            onClick={onToggleDca}
            disabled={toggling}
            aria-label={fund.is_dca ? 'Disable DCA' : 'Enable DCA'}
            style={{ width: 36, height: 20, borderRadius: 10, background: fund.is_dca ? 'var(--c-navy)' : 'var(--c-line-strong)', border: 'none', cursor: toggling ? 'not-allowed' : 'pointer', position: 'relative', transition: 'background 180ms', flexShrink: 0, opacity: toggling ? 0.5 : 1 }}
          >
            <span style={{ position: 'absolute', top: 2, left: fund.is_dca ? 18 : 2, width: 16, height: 16, borderRadius: 8, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 180ms' }} />
          </button>

          {fund.is_dca && (
            isEditing ? (
              <input
                autoFocus
                type="number"
                min="1"
                step="1"
                value={dcaEditValue}
                onChange={(e) => setDcaEditValue(e.target.value)}
                onBlur={() => { onSaveDcaAmount(dcaEditValue); setDcaEditId(null) }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { onSaveDcaAmount(dcaEditValue); setDcaEditId(null) }
                  if (e.key === 'Escape') setDcaEditId(null)
                }}
                placeholder="Amount ₫"
                style={{ width: 90, padding: '3px 8px', fontSize: 11, border: '1px solid var(--c-navy)', borderRadius: 6, background: 'var(--c-card)', fontFamily: 'inherit', outline: 'none', color: 'var(--c-ink)' }}
              />
            ) : fund.dca_monthly_amount_vnd ? (
              <button
                type="button"
                onClick={() => { setDcaEditId(fund.id); setDcaEditValue(String(fund.dca_monthly_amount_vnd)) }}
                style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', background: 'var(--c-navy-tint)', color: 'var(--c-navy)', border: '1px solid var(--c-navy-tint)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                {fund.dca_monthly_amount_vnd.toLocaleString('vi-VN')}₫
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { setDcaEditId(fund.id); setDcaEditValue('') }}
                style={{ fontSize: 11, fontWeight: 500, padding: '2px 8px', background: 'var(--c-navy-tint)', color: 'var(--c-navy)', border: '1px solid var(--c-navy-tint)', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Set amount
              </button>
            )
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MobileFundLibraryView() {
  const t = useTranslations('funds')
  const tc = useTranslations('common')

  // ── Data ──────────────────────────────────────────────────────────────────
  const [funds, setFunds] = useState<Fund[]>(() => getCache() ?? [])
  const [loading, setLoading] = useState(() => !getCache())
  const [error, setError] = useState<string | null>(null)
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
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([])

  // ── Helpers ───────────────────────────────────────────────────────────────

  const addToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = ++toastSeq
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000)
  }, [])

  const loadFunds = useCallback(async (opts?: { force?: boolean }) => {
    if (opts?.force) bustCache()
    setError(null)
    try {
      const res = await fetch('/api/funds')
      if (!res.ok) throw new Error()
      const data = await res.json()
      setCache(data.funds)
      setFunds(data.funds)
    } catch {
      setError('Failed to load funds. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadFunds() }, [loadFunds])

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

  async function handleRefreshNav() {
    setRefreshing(true)
    try {
      const res = await fetch('/api/v1/funds/refresh-nav', { method: 'POST' })
      const { results } = await res.json()
      const updated = results.filter((r: { nav?: number }) => r.nav !== undefined).length
      const failed = results.filter((r: { error?: string }) => r.error).length
      bustCache()
      await loadFunds({ force: true })
      addToast(`${updated} updated${failed ? `, ${failed} failed` : ''}`, failed > 0 && updated === 0 ? 'error' : 'success')
    } catch {
      addToast('Failed to refresh NAV', 'error')
    } finally {
      setRefreshing(false)
    }
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
      bustCache()
      await loadFunds({ force: true })
      addToast(existingId ? 'Fund updated' : 'Fund added')
    } catch {
      setFormError('Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteFund) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/funds/${deleteFund.id}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 204) throw new Error()
      setDeleteFund(null)
      bustCache()
      await loadFunds({ force: true })
      addToast('Fund deleted')
    } catch {
      addToast('Failed to delete fund', 'error')
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
      return
    }

    setTogglingIds((prev) => new Set([...prev, fund.id]))
    try {
      const res = await fetch(`/api/funds/${fund.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: fund.name, code: fund.code, fund_type: fund.fund_type, nav: fund.nav, nav_source_url: fund.nav_source_url, is_dca: false, dca_monthly_amount_vnd: null }) })
      if (!res.ok) throw new Error()
      bustCache()
      await loadFunds({ force: true })
    } catch {
      setFunds((prev) => prev.map((f) => f.id === fund.id ? { ...f, is_dca: true } : f))
      addToast('Failed to update DCA', 'error')
    } finally {
      setTogglingIds((prev) => { const s = new Set(prev); s.delete(fund.id); return s })
    }
  }

  async function handleSaveDcaAmount(fund: Fund, val: string) {
    const amount = Number(val)
    const valid = val !== '' && !isNaN(amount) && amount > 0

    if (!valid) {
      setFunds((prev) => prev.map((f) => f.id === fund.id ? { ...f, is_dca: false, dca_monthly_amount_vnd: null } : f))
      return
    }

    setTogglingIds((prev) => new Set([...prev, fund.id]))
    try {
      const res = await fetch(`/api/funds/${fund.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: fund.name, code: fund.code, fund_type: fund.fund_type, nav: fund.nav, nav_source_url: fund.nav_source_url, is_dca: true, dca_monthly_amount_vnd: amount }) })
      if (!res.ok) throw new Error()
      bustCache()
      await loadFunds({ force: true })
    } catch {
      setFunds((prev) => prev.map((f) => f.id === fund.id ? { ...f, is_dca: false, dca_monthly_amount_vnd: null } : f))
      addToast('Failed to update DCA', 'error')
    } finally {
      setTogglingIds((prev) => { const s = new Set(prev); s.delete(fund.id); return s })
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div data-testid="mobile-funds" className="md:hidden" style={{ minHeight: '100dvh', background: 'var(--c-canvas)' }}>
      {/* Toasts */}
      <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 300, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none' }}>
        {toasts.map((toast) => (
          <div key={toast.id} style={{ padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500, color: '#fff', background: toast.type === 'error' ? 'var(--c-neg)' : 'var(--c-pos)', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', animation: 'fade-in 150ms ease' }}>
            {toast.message}
          </div>
        ))}
      </div>

      <MobileTopBar
        title={t('pageTitle')}
        subtitle={t('pageSubtitle')}
        trailing={
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={handleRefreshNav}
              disabled={refreshing || !funds.some((f) => f.nav_source_url)}
              aria-label="Refresh NAV"
              style={{ padding: 8, background: 'transparent', border: '1px solid var(--c-line)', borderRadius: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', opacity: refreshing || !funds.some((f) => f.nav_source_url) ? 0.4 : 1 }}
            >
              <RefreshCw size={16} color="var(--c-ink)" style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
            </button>
            <button
              onClick={() => { setFormError(null); setAddOpen(true) }}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'var(--c-navy)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              <Plus size={14} strokeWidth={2.5} />
              Add
            </button>
          </div>
        }
      />

      <div style={{ padding: '8px 16px 96px', display: 'grid', gap: 10 }}>
        {/* Search */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 10 }}>
          <Search size={16} color="var(--c-muted)" style={{ flexShrink: 0 }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: 'var(--c-ink)', fontFamily: 'inherit' }}
          />
          {query && (
            <button onClick={() => setQuery('')} style={{ padding: 4, background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              <X size={14} color="var(--c-muted)" />
            </button>
          )}
        </div>

        {/* Filter chips + sort */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, flex: 1, flexWrap: 'wrap' }}>
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.v}
                onClick={() => setFilter(f.v)}
                style={{ padding: '5px 10px', borderRadius: 999, fontSize: 11, fontWeight: 500, background: filter === f.v ? 'var(--c-ink)' : 'var(--c-card)', color: filter === f.v ? '#fff' : 'var(--c-muted)', border: '1px solid ' + (filter === f.v ? 'var(--c-ink)' : 'var(--c-line)'), cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit', transition: 'background 150ms, color 150ms' }}
              >
                {f.l}
              </button>
            ))}
          </div>
          <select
            value={sortKey}
            onChange={(e) => handleSort(e.target.value as SortKey)}
            style={{ fontSize: 11, padding: '5px 8px', background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 8, color: 'var(--c-ink)', fontFamily: 'inherit', flexShrink: 0, cursor: 'pointer' }}
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s.v} value={s.v}>{s.l} {sortKey === s.v ? (sortAsc ? '↑' : '↓') : ''}</option>
            ))}
          </select>
        </div>

        {/* Count */}
        <div style={{ fontSize: 12, color: 'var(--c-muted)', paddingLeft: 2 }}>
          {t('fundsCount', { count: sortedFunds.length })}
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div style={{ display: 'grid', gap: 8 }}>
            {[...Array(3)].map((_, i) => (
              <div key={i} style={{ background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 16, padding: '12px 14px', display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--c-line)' }} />
                  <div style={{ flex: 1, display: 'grid', gap: 6 }}>
                    <div style={{ height: 13, width: '55%', background: 'var(--c-line)', borderRadius: 4 }} />
                    <div style={{ height: 10, width: '75%', background: 'var(--c-line)', borderRadius: 4 }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div style={{ padding: '32px 20px', textAlign: 'center', background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 16 }}>
            <p style={{ color: 'var(--c-neg)', fontSize: 13, margin: '0 0 12px' }}>{error}</p>
            <button onClick={() => loadFunds()} style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, background: 'var(--c-navy)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit' }}>
              Retry
            </button>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && funds.length === 0 && (
          <div style={{ padding: '44px 20px', textAlign: 'center', background: 'var(--c-card)', border: '1px dashed var(--c-line-strong)', borderRadius: 16 }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>📚</div>
            <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: 'var(--c-ink)' }}>{t('empty')}</h3>
            <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--c-muted)' }}>{t('emptyDesc')}</p>
            <button onClick={() => { setFormError(null); setAddOpen(true) }} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, background: 'var(--c-navy)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit' }}>
              <Plus size={14} />
              {t('add')}
            </button>
          </div>
        )}

        {/* No search results */}
        {!loading && !error && funds.length > 0 && sortedFunds.length === 0 && (
          <div style={{ padding: '32px 20px', textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: 'var(--c-muted)', margin: 0 }}>No funds match your search</p>
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
                onEdit={() => { setFormError(null); setEditFund(fund) }}
                onDelete={() => setDeleteFund(fund)}
                onToggleDca={() => handleToggleDca(fund)}
                onSaveDcaAmount={(val) => handleSaveDcaAmount(fund, val)}
                setDcaEditId={setDcaEditId}
                setDcaEditValue={setDcaEditValue}
              />
            ))}
          </div>
        )}

        {/* NAV info banner */}
        {!loading && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, marginTop: 4 }}>
            <div style={{ width: 20, height: 20, borderRadius: 10, background: '#2563eb', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1, fontSize: 11, fontWeight: 700 }}>i</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#1e40af', marginBottom: 2 }}>{t('navInfoTitle')}</div>
              <div style={{ fontSize: 11, color: '#3b82f6', lineHeight: 1.5 }}>{t('navInfoDesc', { refreshNav: t('refreshNav') })}</div>
            </div>
          </div>
        )}
      </div>

      {/* Add sheet */}
      <Sheet open={addOpen} onClose={() => { setAddOpen(false); setFormError(null) }} testId="fund-sheet">
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
      <Sheet open={!!editFund} onClose={() => { setEditFund(null); setFormError(null) }} testId="fund-sheet">
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
            <p style={{ margin: 0, fontWeight: 700, fontSize: 16, color: 'var(--c-ink)' }}>Delete {deleteFund.code}?</p>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--c-muted)', lineHeight: 1.5 }}>{t('deleteCannotUndo')}</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setDeleteFund(null)} disabled={deleting} style={{ flex: 1, padding: '10px 14px', fontSize: 13, fontWeight: 600, border: '1px solid var(--c-line)', borderRadius: 10, background: 'var(--c-card)', color: 'var(--c-ink)', cursor: 'pointer', fontFamily: 'inherit' }}>
                {tc('cancel')}
              </button>
              <button onClick={handleDelete} disabled={deleting} style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 14px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 10, background: 'var(--c-neg)', color: '#fff', cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.6 : 1, fontFamily: 'inherit' }}>
                <Trash2 size={14} />
                {deleting ? tc('deleting') : tc('delete')}
              </button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  )
}
