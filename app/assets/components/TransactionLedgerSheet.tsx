'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Plus, Download, Edit, Trash2, ChevronLeft, ChevronRight, X, Calendar, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import ConfirmModal from '@/app/components/ConfirmModal'
import AmountInput from '@/app/components/ui/AmountInput'
import DecimalInput from '@/app/components/ui/DecimalInput'
import { fmtCompact, fmtNav, fmtUnits } from '@/lib/formatters'
import { parseExcelPaste, type ParsedRow } from '@/lib/parseExcelPaste'
import { ASSET_TYPES, type AssetType, type LedgerTransaction, isWithdrawal, txPrimaryName, fmtTxDate } from './transactionUtils'

interface Goal { goal_id: string; goal_name: string }
interface Fund { id: string; name: string; code: string; nav: number }

// Asset-type pill colors — match RecentActivityCard.
const ASSET_BADGE: Record<AssetType, string> = {
  fund: '#2563eb',
  bank: '#047857',
  stock: '#7c3aed',
  gold: '#b45309',
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 10, fontWeight: 600,
  letterSpacing: '0.06em', textTransform: 'uppercase',
  color: 'var(--c-muted)', marginBottom: 6,
}

interface AppliedFilters { asset_type: string; goal_id: string; from_date: string; to_date: string }
const EMPTY_FILTERS: AppliedFilters = { asset_type: '', goal_id: '', from_date: '', to_date: '' }

const emptyTxForm = {
  asset_type: 'bank',
  investment_date: '',
  amount_vnd: '',
  unit_price: '',
  units: '',
  interest_rate: '',
  expiry_date: '',
  notes: '',
  fund_id: '',
  goal_id: '',
}

// Busting the dashboard overview cache keeps the Recent activity card + net
// worth panel in sync after a mutation in the ledger.
function bustDashboardCache() {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('dashboardOverviewCache'))
      .forEach((k) => localStorage.removeItem(k))
  } catch { /* ignore */ }
}

// ─── Modal (desktop) / bottom sheet (mobile) shell ──────────────────────────
// Mirrors AddTransactionSheet so every transaction surface shares one chrome.
function Shell({ open, onClose, title, desktop, width = 520, testId, children }: {
  open: boolean
  onClose: () => void
  title: string
  desktop?: boolean
  width?: number
  testId?: string
  children: React.ReactNode
}) {
  const [mounted, setMounted] = useState(open)
  useEffect(() => {
    if (open) { setMounted(true); return }
    const t = setTimeout(() => setMounted(false), 220)
    return () => clearTimeout(t)
  }, [open])
  if (desktop ? !open : !mounted) return null

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: desktop ? '18px 20px 14px' : '0 16px 16px', borderBottom: desktop ? '1px solid var(--c-line)' : 'none', flexShrink: 0 }}>
      <h3 style={{ margin: 0, fontSize: desktop ? 16 : 17, fontWeight: desktop ? 700 : 600, letterSpacing: '-0.01em', color: 'var(--c-ink)' }}>{title}</h3>
      <button onClick={onClose} style={{ padding: 6, border: 'none', background: 'transparent', borderRadius: 8, cursor: 'pointer', color: 'var(--c-muted)', display: 'flex' }} aria-label="Close"><X size={18} /></button>
    </div>
  )

  if (desktop) {
    return (
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, animation: 'fade-in 150ms ease', backdropFilter: 'blur(2px)' }}>
        <div data-testid={testId} onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: width, maxHeight: 'calc(100vh - 48px)', background: 'var(--c-card)', borderRadius: 16, boxShadow: '0 24px 48px rgba(15,23,42,0.18), 0 8px 16px rgba(15,23,42,0.08)', display: 'flex', flexDirection: 'column', animation: 'modal-in 200ms cubic-bezier(0.2,0.8,0.2,1)', overflow: 'hidden' }}>
          {header}
          <div style={{ flex: 1, padding: '18px 20px', overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain' }}>{children}</div>
        </div>
      </div>
    )
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', animation: open ? 'fade-in 180ms ease' : 'fade-out 180ms ease forwards', pointerEvents: open ? 'auto' : 'none' }}>
      <div data-testid={testId} onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, maxHeight: '90dvh', background: 'var(--c-card)', borderTopLeftRadius: 20, borderTopRightRadius: 20, display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: open ? 'slide-up 220ms cubic-bezier(0.2,0.8,0.2,1)' : 'slide-down 180ms ease forwards', boxShadow: '0 -8px 24px rgba(0,0,0,0.12)' }}>
        <div style={{ width: 36, height: 4, background: 'var(--c-line-strong)', borderRadius: 999, margin: '6px auto 14px', flexShrink: 0 }} />
        {header}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', touchAction: 'pan-y', padding: '0 16px 24px' }}>{children}</div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ minWidth: 0 }}><label style={labelStyle}>{label}</label>{children}</div>
}

interface Props {
  open: boolean
  desktop?: boolean
  locale: string
  onClose: () => void
  onChanged?: () => void
}

export default function TransactionLedgerSheet({ open, desktop, locale, onClose, onChanged }: Props) {
  const t = useTranslations('transactions')
  const tc = useTranslations('common')

  const [transactions, setTransactions] = useState<LedgerTransaction[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [funds, setFunds] = useState<Fund[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  const [filters, setFilters] = useState<AppliedFilters>(EMPTY_FILTERS)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [txForm, setTxForm] = useState(emptyTxForm)
  const [editTx, setEditTx] = useState<LedgerTransaction | null>(null)
  const [formMode, setFormMode] = useState<'add' | 'edit' | null>(null)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmTx, setConfirmTx] = useState<LedgerTransaction | null>(null)

  const [showImport, setShowImport] = useState(false)
  const [importFundId, setImportFundId] = useState('')
  const [importRaw, setImportRaw] = useState('')
  const [importRows, setImportRows] = useState<ParsedRow[]>([])
  const [importing, setImporting] = useState(false)

  const assetLabelOf = useCallback((a?: string | null): string => {
    if (!a) return '—'
    return t(`asset${a.charAt(0).toUpperCase() + a.slice(1)}` as 'assetFund' | 'assetBank' | 'assetStock' | 'assetGold')
  }, [t])

  const fetchGoals = useCallback(async () => {
    const res = await fetch('/api/v1/savings-goals')
    const { goals: g } = res.ok ? await res.json() : { goals: [] }
    setGoals(g ?? [])
  }, [])

  const fetchFunds = useCallback(async () => {
    const res = await fetch('/api/funds')
    const data = res.ok ? await res.json() : {}
    setFunds(data.funds ?? [])
  }, [])

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page) })
    if (filters.asset_type) params.set('asset_type', filters.asset_type)
    if (filters.from_date) params.set('from_date', filters.from_date)
    if (filters.to_date) params.set('to_date', filters.to_date)
    if (filters.goal_id === 'unassigned') params.set('unassigned', 'true')
    else if (filters.goal_id) params.set('goal_id', filters.goal_id)

    const res = await fetch(`/api/v1/investment-transactions?${params}`)
    const data = res.ok ? await res.json() : { transactions: [], total: 0 }
    setTransactions(data.transactions ?? [])
    setTotal(data.total ?? 0)
    setLoading(false)
  }, [page, filters])

  // Load only while open — avoids fetching for every dashboard render.
  useEffect(() => { if (open) { fetchGoals(); fetchFunds() } }, [open, fetchGoals, fetchFunds])
  useEffect(() => { if (open) fetchTransactions() }, [open, fetchTransactions])

  // Lock background scroll while the ledger is open.
  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [open])

  function setSelectFilter(key: 'asset_type' | 'goal_id', value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setPage(1)
  }

  function setDateFilter(key: 'from_date' | 'to_date', value: string, setter: (v: string) => void) {
    setter(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setFilters((prev) => ({ ...prev, [key]: value }))
      setPage(1)
    }, 400)
  }

  function resetFilters() {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setDateFrom('')
    setDateTo('')
    setFilters(EMPTY_FILTERS)
    setPage(1)
  }

  function openAdd() {
    setTxForm({ ...emptyTxForm, investment_date: new Date().toISOString().slice(0, 10) })
    setEditTx(null)
    setFormError('')
    setFormMode('add')
  }

  function openEdit(tx: LedgerTransaction) {
    setTxForm({
      asset_type: tx.asset_type ?? 'bank',
      investment_date: tx.investment_date,
      amount_vnd: String(tx.amount_vnd),
      unit_price: tx.unit_price != null ? String(tx.unit_price) : '',
      units: tx.units != null ? String(tx.units) : '',
      interest_rate: tx.interest_rate != null ? String(tx.interest_rate) : '',
      expiry_date: tx.expiry_date ?? '',
      notes: tx.notes ?? '',
      fund_id: tx.fund_id ?? '',
      goal_id: tx.goal_id ?? '',
    })
    setEditTx(tx)
    setFormError('')
    setFormMode('edit')
  }

  function notifyChanged() {
    bustDashboardCache()
    onChanged?.()
  }

  async function handleSave() {
    setFormError('')
    if (!txForm.amount_vnd || Number(txForm.amount_vnd) <= 0) { setFormError(t('amountRequired')); return }
    if (!txForm.investment_date) { setFormError(t('dateRequired')); return }

    const payload = {
      asset_type: txForm.asset_type,
      investment_date: txForm.investment_date,
      amount_vnd: Number(txForm.amount_vnd),
      unit_price: txForm.unit_price ? Number(txForm.unit_price) : null,
      units: txForm.units ? Number(txForm.units) : null,
      interest_rate: txForm.interest_rate ? Number(txForm.interest_rate) : null,
      expiry_date: txForm.asset_type === 'bank' ? (txForm.expiry_date || null) : null,
      notes: txForm.notes || null,
      fund_id: txForm.asset_type === 'fund' ? (txForm.fund_id || null) : null,
      goal_id: txForm.goal_id || null,
    }

    setSaving(true)
    const url = editTx
      ? `/api/v1/investment-transactions/${editTx.transaction_id}`
      : '/api/v1/investment-transactions'
    const res = await fetch(url, {
      method: editTx ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const { error } = await res.json()
      setFormError(error ?? tc('error'))
    } else {
      setFormMode(null)
      await fetchTransactions()
      notifyChanged()
    }
    setSaving(false)
  }

  function handleImportPaste(raw: string) {
    setImportRaw(raw)
    setImportRows(raw.trim() ? parseExcelPaste(raw) : [])
  }

  async function handleImport() {
    const validRows = importRows.filter((r) => !r.error)
    if (!importFundId || validRows.length === 0) return
    setImporting(true)
    const res = await fetch('/api/v1/investment-transactions/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transactions: validRows.map((r) => ({
          fund_id: importFundId,
          investment_date: r.investment_date,
          amount_vnd: r.amount_vnd,
          unit_price: r.unit_price,
          units: r.units,
        })),
      }),
    })
    setImporting(false)
    if (res.ok) {
      setShowImport(false)
      setImportRaw('')
      setImportRows([])
      setImportFundId('')
      await fetchTransactions()
      notifyChanged()
    }
  }

  async function handleDelete(tx: LedgerTransaction) {
    setDeletingId(tx.transaction_id)
    const res = await fetch(`/api/v1/investment-transactions/${tx.transaction_id}`, { method: 'DELETE' })
    if (res.ok) {
      setConfirmTx(null)
      await fetchTransactions()
      notifyChanged()
    }
    setDeletingId(null)
  }

  const totalPages = Math.max(1, Math.ceil(total / 20))
  const hasFilters = !!(filters.asset_type || filters.goal_id || filters.from_date || filters.to_date)

  const dirMeta = (tx: LedgerTransaction) => isWithdrawal(tx)
    ? { Icon: ArrowDownRight, color: 'var(--c-neg)', label: t('withdrawal') }
    : { Icon: ArrowUpRight, color: 'var(--c-pos)', label: t('investment') }

  // ── Type badge (icon chip + direction label + asset pill) ──
  const TxBadge = ({ tx }: { tx: LedgerTransaction }) => {
    const m = dirMeta(tx)
    const aColor = ASSET_BADGE[tx.asset_type as AssetType] ?? 'var(--c-muted)'
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 22, height: 22, borderRadius: 6, background: `color-mix(in srgb, ${m.color} 12%, transparent)`, color: m.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <m.Icon size={12} strokeWidth={2.2} />
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: m.color }}>{m.label}</span>
        {tx.asset_type && (
          <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 999, color: aColor, background: `color-mix(in srgb, ${aColor} 14%, transparent)` }}>{assetLabelOf(tx.asset_type)}</span>
        )}
      </span>
    )
  }

  const goalPill = (tx: LedgerTransaction) => (
    tx.savings_goals?.goal_name
      ? <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'var(--c-navy-tint)', color: 'var(--c-navy)' }}>{tx.savings_goals.goal_name}</span>
      : <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'var(--c-card-2)', color: 'var(--c-muted)' }}>{t('noGoal')}</span>
  )

  const amountCell = (tx: LedgerTransaction) => {
    const w = isWithdrawal(tx)
    return (
      <span className="tabular" style={{ fontSize: 13, fontWeight: 600, color: w ? 'var(--c-neg)' : 'var(--c-ink)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
        {w ? '−' : ''}{fmtCompact(tx.amount_vnd)}
      </span>
    )
  }

  const rowActions = (tx: LedgerTransaction) => (
    <span style={{ display: 'inline-flex', gap: 2, whiteSpace: 'nowrap' }}>
      {!isWithdrawal(tx) && (
        <button onClick={() => openEdit(tx)} className="cn-btn ghost" style={{ padding: 5 }} aria-label={tc('edit')}><Edit size={14} color="var(--c-muted)" /></button>
      )}
      <button onClick={() => setConfirmTx(tx)} className="cn-btn ghost" style={{ padding: 5 }} aria-label={tc('delete')}><Trash2 size={14} color="var(--c-neg)" /></button>
    </span>
  )

  return (
    <>
      <Shell open={open} onClose={onClose} title={t('ledgerTitle')} desktop={desktop} width={880} testId="tx-ledger">
        <div style={{ display: 'grid', gap: 14 }}>
          {/* Toolbar: filters + actions */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
            <Field label={t('lblAsset')}>
              <select value={filters.asset_type} onChange={(e) => setSelectFilter('asset_type', e.target.value)} className="cn-input" style={{ cursor: 'pointer', padding: '8px 10px' }}>
                <option value="">{t('filterAll')}</option>
                {ASSET_TYPES.map((v) => <option key={v} value={v}>{assetLabelOf(v)}</option>)}
              </select>
            </Field>
            <Field label={t('filterGoal')}>
              <select value={filters.goal_id} onChange={(e) => setSelectFilter('goal_id', e.target.value)} className="cn-input" style={{ cursor: 'pointer', padding: '8px 10px' }}>
                <option value="">{t('allGoals')}</option>
                <option value="unassigned">{t('noGoal')}</option>
                {goals.map((g) => <option key={g.goal_id} value={g.goal_id}>{g.goal_name}</option>)}
              </select>
            </Field>
            <Field label={t('lblFrom')}>
              <input type="date" value={dateFrom} onChange={(e) => setDateFilter('from_date', e.target.value, setDateFrom)} className="cn-input tabular" style={{ padding: '8px 10px' }} />
            </Field>
            <Field label={t('lblTo')}>
              <input type="date" value={dateTo} onChange={(e) => setDateFilter('to_date', e.target.value, setDateTo)} className="cn-input tabular" style={{ padding: '8px 10px' }} />
            </Field>
            {hasFilters && (
              <button onClick={resetFilters} className="cn-btn" style={{ padding: '8px 12px', fontSize: 12 }}>{tc('reset')}</button>
            )}
            <div style={{ flex: 1 }} />
            <button data-testid="tx-ledger-import" onClick={() => { setShowImport(true); setImportRaw(''); setImportRows([]); setImportFundId('') }} className="cn-btn" style={{ padding: '8px 12px', fontSize: 12 }}>
              <Download size={14} />{t('import')}
            </button>
            <button data-testid="tx-ledger-add" onClick={openAdd} className="cn-btn primary" style={{ padding: '8px 14px', fontSize: 12 }}>
              <Plus size={14} strokeWidth={2.4} />{t('add')}
            </button>
          </div>

          {loading ? (
            <div style={{ padding: '40px 16px', textAlign: 'center', fontSize: 13, color: 'var(--c-muted)' }}>{tc('loading')}</div>
          ) : total === 0 && !hasFilters ? (
            /* Empty state */
            <div style={{ padding: '44px 20px', textAlign: 'center', border: '1px dashed var(--c-line-strong)', borderRadius: 14 }}>
              <div style={{ width: 52, height: 52, borderRadius: 26, background: 'var(--c-card-2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14, color: 'var(--c-muted)' }}>
                <Calendar size={24} />
              </div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{t('empty')}</h3>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 18 }}>
                <button onClick={() => { setShowImport(true); setImportRaw(''); setImportRows([]); setImportFundId('') }} className="cn-btn"><Download size={15} />{t('importModalTitle')}</button>
                <button onClick={openAdd} className="cn-btn primary"><Plus size={15} strokeWidth={2.4} />{t('addTitle')}</button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: 'var(--c-muted)' }}>{t('totalCount', { count: total })}</div>

              {desktop ? (
                /* Desktop table */
                <div className="cn-card" style={{ overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: 'var(--c-card-2)', borderBottom: '1px solid var(--c-line)' }}>
                        {[t('colDate'), t('colTransaction'), t('lblAsset'), t('colGoal'), t('colAmount'), ''].map((h, i) => (
                          <th key={i} style={{ padding: '9px 14px', textAlign: i >= 4 ? 'right' : 'left', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-muted)' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((tx, i) => (
                        <tr key={tx.transaction_id} style={{ borderBottom: i < transactions.length - 1 ? '1px solid var(--c-line)' : 'none' }}>
                          <td className="tabular" style={{ padding: '11px 14px', fontSize: 12, color: 'var(--c-muted)', whiteSpace: 'nowrap' }}>{fmtTxDate(tx.investment_date, locale)}</td>
                          <td style={{ padding: '11px 14px' }}><TxBadge tx={tx} /></td>
                          <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 500, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{txPrimaryName(tx, assetLabelOf(tx.asset_type))}</td>
                          <td style={{ padding: '11px 14px' }}>{goalPill(tx)}</td>
                          <td style={{ padding: '11px 14px', textAlign: 'right' }}>{amountCell(tx)}</td>
                          <td style={{ padding: '11px 10px 11px 4px', textAlign: 'right' }}>{rowActions(tx)}</td>
                        </tr>
                      ))}
                      {transactions.length === 0 && (
                        <tr><td colSpan={6} style={{ padding: '28px 14px', textAlign: 'center', fontSize: 13, color: 'var(--c-muted)' }}>{t('noMatch')}</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                /* Mobile list */
                <div style={{ display: 'grid', gap: 8 }}>
                  {transactions.map((tx) => {
                    const m = dirMeta(tx)
                    return (
                      <div key={tx.transaction_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, border: '1px solid var(--c-line)', background: 'var(--c-card)' }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: `color-mix(in srgb, ${m.color} 12%, transparent)`, color: m.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <m.Icon size={14} strokeWidth={2.2} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{txPrimaryName(tx, assetLabelOf(tx.asset_type))}</div>
                          <div style={{ fontSize: 10, color: 'var(--c-muted)', marginTop: 2 }}>{m.label} · {tx.savings_goals?.goal_name ?? t('noGoal')} · {fmtTxDate(tx.investment_date, locale)}</div>
                        </div>
                        {amountCell(tx)}
                        {rowActions(tx)}
                      </div>
                    )
                  })}
                  {transactions.length === 0 && (
                    <div style={{ padding: '24px 12px', textAlign: 'center', fontSize: 13, color: 'var(--c-muted)' }}>{t('noMatch')}</div>
                  )}
                </div>
              )}

              {/* Pagination */}
              {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{t('page')} {page} / {totalPages}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="cn-btn" style={{ padding: '6px 10px' }}><ChevronLeft size={14} /></button>
                    <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="cn-btn" style={{ padding: '6px 10px' }}><ChevronRight size={14} /></button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </Shell>

      {/* Add / edit */}
      <Shell open={!!formMode} onClose={() => setFormMode(null)} title={formMode === 'add' ? t('addTitle') : t('editTitle')} desktop={desktop} width={520}>
        <form onSubmit={(e) => { e.preventDefault(); handleSave() }} style={{ display: 'grid', gap: 14 }}>
          <Field label={t('filterAssetType')}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {ASSET_TYPES.map((v) => {
                const active = txForm.asset_type === v
                return (
                  <button key={v} type="button" onClick={() => setTxForm((f) => ({ ...f, asset_type: v, fund_id: '', unit_price: '', units: '', interest_rate: '', expiry_date: '' }))}
                    style={{ padding: '7px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', background: active ? 'var(--c-navy)' : 'var(--c-card-2)', color: active ? '#fff' : 'var(--c-muted)', border: `1px solid ${active ? 'var(--c-navy)' : 'var(--c-line)'}`, transition: 'all 120ms' }}>
                    {assetLabelOf(v)}
                  </button>
                )
              })}
            </div>
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {txForm.asset_type === 'fund' ? (
              <Field label={t('assetFund')}>
                <select value={txForm.fund_id} onChange={(e) => setTxForm((f) => ({ ...f, fund_id: e.target.value }))} className="cn-input" style={{ cursor: 'pointer' }}>
                  <option value="">{t('selectFund')}</option>
                  {funds.map((f) => <option key={f.id} value={f.id}>{f.code} - {f.name}</option>)}
                </select>
              </Field>
            ) : <div />}
            <Field label={t('colGoal')}>
              <select value={txForm.goal_id} onChange={(e) => setTxForm((f) => ({ ...f, goal_id: e.target.value }))} className="cn-input" style={{ cursor: 'pointer' }}>
                <option value="">{t('noGoal')}</option>
                {goals.map((g) => <option key={g.goal_id} value={g.goal_id}>{g.goal_name}</option>)}
              </select>
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label={t('colDate')}>
              <input type="date" value={txForm.investment_date} onChange={(e) => setTxForm((f) => ({ ...f, investment_date: e.target.value }))} className="cn-input tabular" />
            </Field>
            <Field label={t('colAmount')}>
              <AmountInput value={txForm.amount_vnd} onChange={(raw) => setTxForm((f) => ({ ...f, amount_vnd: raw }))} placeholder="10,000,000" className="cn-input tabular" />
            </Field>
          </div>

          {txForm.asset_type === 'fund' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label={t('navAtBuy')}>
                <DecimalInput value={txForm.unit_price} onChange={(v) => setTxForm((f) => ({ ...f, unit_price: v }))} placeholder="22,215.12" className="cn-input tabular" />
              </Field>
              <Field label={t('unitsFund')}>
                <DecimalInput value={txForm.units} onChange={(v) => setTxForm((f) => ({ ...f, units: v }))} placeholder="450.25" className="cn-input tabular" />
              </Field>
            </div>
          )}

          {txForm.asset_type !== 'bank' && txForm.asset_type !== 'fund' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label={t('unitPrice')}>
                <DecimalInput value={txForm.unit_price} onChange={(v) => setTxForm((f) => ({ ...f, unit_price: v }))} className="cn-input tabular" />
              </Field>
              <Field label={txForm.asset_type === 'stock' ? t('unitsStock') : t('unitsGold')}>
                <DecimalInput value={txForm.units} onChange={(v) => setTxForm((f) => ({ ...f, units: v }))} className="cn-input tabular" />
              </Field>
            </div>
          )}

          {txForm.asset_type === 'bank' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label={t('colInterest')}>
                <input type="number" step="0.01" value={txForm.interest_rate} onChange={(e) => setTxForm((f) => ({ ...f, interest_rate: e.target.value }))} placeholder="6.5" className="cn-input tabular" />
              </Field>
              <Field label={t('colExpiry')}>
                <input type="date" value={txForm.expiry_date} onChange={(e) => setTxForm((f) => ({ ...f, expiry_date: e.target.value }))} className="cn-input tabular" />
              </Field>
            </div>
          )}

          <Field label={tc('notes')}>
            <textarea value={txForm.notes} onChange={(e) => setTxForm((f) => ({ ...f, notes: e.target.value }))} rows={2} className="cn-input" style={{ resize: 'none' }} />
          </Field>

          {formError && <p style={{ margin: 0, fontSize: 13, color: 'var(--c-neg)' }}>{formError}</p>}

          <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
            <button type="button" onClick={() => setFormMode(null)} className="cn-btn" style={{ flex: 1, justifyContent: 'center' }}>{tc('cancel')}</button>
            <button type="submit" className="cn-btn primary" style={{ flex: 2, justifyContent: 'center' }} disabled={saving}>{saving ? tc('saving') : tc('save')}</button>
          </div>
        </form>
      </Shell>

      {/* Import from Excel */}
      <Shell open={showImport} onClose={() => setShowImport(false)} title={t('importModalTitle')} desktop={desktop} width={640}>
        <div style={{ display: 'grid', gap: 14 }}>
          <Field label={t('assetFund')}>
            <select value={importFundId} onChange={(e) => setImportFundId(e.target.value)} className="cn-input" style={{ cursor: 'pointer' }}>
              <option value="">{t('selectFund')}</option>
              {funds.map((f) => <option key={f.id} value={f.id}>{f.code} - {f.name}</option>)}
            </select>
          </Field>
          <Field label={t('pasteFromExcel')}>
            <div style={{ fontSize: 11, color: 'var(--c-muted)', marginBottom: 6 }}>Tháng | Tiền chuyển | (skip) | NAV | CCQ</div>
            <textarea value={importRaw} onChange={(e) => handleImportPaste(e.target.value)} rows={5} className="cn-input tabular" style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
              placeholder={'7/2023\t10,000,000\t9,876,543\t23,375.28\t42.78\n8/2023\t10,000,000\t9,876,543\t24,100.00\t40.98'} />
          </Field>

          {importRows.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-muted)', marginBottom: 6 }}>
                {t('importPreview', { valid: importRows.filter((r) => !r.error).length, total: importRows.length })}
              </div>
              <div className="cn-card" style={{ overflow: 'hidden', maxHeight: 220, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--c-card-2)' }}>
                      {[t('colImportDate'), t('colImportAmount'), t('colImportNav'), t('colImportUnits'), ''].map((h, i) => (
                        <th key={i} style={{ padding: '7px 10px', textAlign: i === 0 ? 'left' : 'right', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: 'var(--c-muted)', letterSpacing: '0.05em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importRows.map((r, i) => (
                      <tr key={i} style={{ borderTop: '1px solid var(--c-line)', background: r.error ? 'var(--c-neg-tint)' : 'var(--c-card)' }}>
                        <td style={{ padding: '7px 10px', color: 'var(--c-ink)' }}>{r.investment_date || '—'}</td>
                        <td className="tabular" style={{ padding: '7px 10px', textAlign: 'right' }}>{isNaN(r.amount_vnd) ? '—' : Math.round(r.amount_vnd).toLocaleString('en-US')}</td>
                        <td className="tabular" style={{ padding: '7px 10px', textAlign: 'right' }}>{isNaN(r.unit_price) ? '—' : fmtNav(r.unit_price)}</td>
                        <td className="tabular" style={{ padding: '7px 10px', textAlign: 'right' }}>{isNaN(r.units) ? '—' : fmtUnits(r.units)}</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right' }}>{r.error ? <span style={{ color: 'var(--c-neg)', fontSize: 11 }}>{r.error}</span> : <span style={{ color: 'var(--c-pos)' }}>✓</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowImport(false)} className="cn-btn" style={{ flex: 1, justifyContent: 'center' }}>{tc('cancel')}</button>
            <button onClick={handleImport} className="cn-btn primary" style={{ flex: 2, justifyContent: 'center' }} disabled={importing || !importFundId || importRows.filter((r) => !r.error).length === 0}>
              {importing ? t('importing') : t('importCount', { count: importRows.filter((r) => !r.error).length })}
            </button>
          </div>
        </div>
      </Shell>

      <ConfirmModal
        open={!!confirmTx}
        title={tc('delete')}
        message={confirmTx ? t('deleteMessage') : ''}
        confirming={deletingId === confirmTx?.transaction_id}
        onConfirm={() => confirmTx && handleDelete(confirmTx)}
        onCancel={() => setConfirmTx(null)}
      />
    </>
  )
}
