'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Plus, FileSpreadsheet, Edit, Trash2, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'
import ConfirmModal from '@/app/components/ConfirmModal'
import AmountInput from '@/app/components/ui/AmountInput'
import DecimalInput from '@/app/components/ui/DecimalInput'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { fmt, fmtNav, fmtUnits } from '@/lib/formatters'
import { parseExcelPaste, type ParsedRow } from '@/lib/parseExcelPaste'
import { ASSET_TYPES, type AssetType, type LedgerTransaction } from './transactionUtils'

interface Goal { goal_id: string; goal_name: string }
interface Fund { id: string; name: string; code: string; nav: number }

const ASSET_COLORS: Record<AssetType, string> = {
  fund: 'bg-purple-100 text-purple-700',
  bank: 'bg-blue-100 text-blue-700',
  stock: 'bg-green-100 text-green-700',
  gold: 'bg-amber-100 text-amber-700',
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

interface Props {
  open: boolean
  onClose: () => void
  onChanged?: () => void
}

export default function TransactionLedgerSheet({ open, onClose, onChanged }: Props) {
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

  // Only load while open — avoids fetching for every dashboard render.
  useEffect(() => { if (open) { fetchGoals(); fetchFunds() } }, [open, fetchGoals, fetchFunds])
  useEffect(() => { if (open) fetchTransactions() }, [open, fetchTransactions])

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

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent data-testid="tx-ledger" className="sm:max-w-[880px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Toolbar: filters + actions */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block uppercase tracking-wide">{t('filterAssetType')}</label>
              <div className="relative">
                <select
                  value={filters.asset_type}
                  onChange={(e) => setSelectFilter('asset_type', e.target.value)}
                  className="appearance-none border border-black/10 dark:border-gray-600 rounded-lg pl-3 pr-8 py-2 text-sm font-medium bg-[#f3f3f5] dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">{t('filterAll')}</option>
                  {ASSET_TYPES.map((type) => <option key={type} value={type}>{t(`asset${type.charAt(0).toUpperCase() + type.slice(1)}` as 'assetFund' | 'assetBank' | 'assetStock' | 'assetGold')}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              </div>
            </div>
            <div className="min-w-0">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block uppercase tracking-wide">{t('filterGoal')}</label>
              <div className="relative">
                <select
                  value={filters.goal_id}
                  onChange={(e) => setSelectFilter('goal_id', e.target.value)}
                  className="appearance-none border border-black/10 dark:border-gray-600 rounded-lg pl-3 pr-8 py-2 text-sm font-medium bg-[#f3f3f5] dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">{t('allGoals')}</option>
                  <option value="unassigned">{t('noGoal')}</option>
                  {goals.map((g) => <option key={g.goal_id} value={g.goal_id}>{g.goal_name}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              </div>
            </div>
            <div className="min-w-0">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block uppercase tracking-wide">{t('filterFrom')}</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFilter('from_date', e.target.value, setDateFrom)}
                className="border border-black/10 dark:border-gray-600 rounded-lg px-3 py-2 text-sm font-medium bg-[#f3f3f5] dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            <div className="min-w-0">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block uppercase tracking-wide">{t('filterTo')}</label>
              <input type="date" value={dateTo} onChange={(e) => setDateFilter('to_date', e.target.value, setDateTo)}
                className="border border-black/10 dark:border-gray-600 rounded-lg px-3 py-2 text-sm font-medium bg-[#f3f3f5] dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            {(filters.asset_type || filters.goal_id || filters.from_date || filters.to_date) && (
              <button onClick={resetFilters} className="h-9 px-3 text-sm font-medium text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">{tc('reset')}</button>
            )}
            <div className="flex-1" />
            <button
              data-testid="tx-ledger-import"
              onClick={() => { setShowImport(true); setImportRaw(''); setImportRows([]); setImportFundId('') }}
              className="flex items-center gap-2 h-9 px-3 text-sm font-medium text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <FileSpreadsheet className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">{t('import')}</span>
            </button>
            <button
              data-testid="tx-ledger-add"
              onClick={openAdd}
              className="flex items-center gap-2 h-9 px-3 sm:px-4 bg-gray-950 hover:bg-gray-800 text-white text-sm font-bold rounded-md transition-colors"
            >
              <Plus className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">{t('add')}</span>
            </button>
          </div>

          {/* Count */}
          {!loading && total > 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('totalCount', { count: total })}</p>
          )}

          {/* List */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-black/10 dark:border-gray-700 overflow-hidden">
            {loading ? (
              <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">{tc('loading')}</div>
            ) : transactions.length === 0 ? (
              <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">
                {(filters.asset_type || filters.goal_id || filters.from_date || filters.to_date) ? t('noMatch') : t('empty')}
              </div>
            ) : (
              <>
                {/* Mobile card layout */}
                <div className="sm:hidden divide-y divide-black/5 dark:divide-gray-700 px-4 py-2">
                  {transactions.map((tx) => {
                    const isWithdrawal = tx.transaction_type === 'withdrawal'
                    const gain = isWithdrawal && tx.principal_withdrawn != null ? tx.amount_vnd - tx.principal_withdrawn : null
                    const rateOrNav = tx.asset_type === 'fund'
                      ? (tx.unit_price != null ? fmtNav(tx.unit_price) : '—')
                      : (tx.interest_rate != null ? `${tx.interest_rate}%` : '—')
                    const rateOrNavLabel = tx.asset_type === 'fund' ? t('colTransaction') : t('colInterest')
                    const fundCode = tx.asset_type === 'fund' ? funds.find((f) => f.id === tx.fund_id)?.code : null
                    return (
                      <div key={tx.transaction_id} className="py-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            {isWithdrawal ? (
                              <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">{t('withdrawal')}</span>
                            ) : (
                              <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${ASSET_COLORS[tx.asset_type as AssetType] ?? 'bg-gray-100 text-gray-700'}`}>
                                {tx.asset_type ? t(`asset${tx.asset_type.charAt(0).toUpperCase() + tx.asset_type.slice(1)}` as 'assetFund' | 'assetBank' | 'assetStock' | 'assetGold') : '—'}
                              </span>
                            )}
                            {fundCode && <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{fundCode}</span>}
                          </div>
                          <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">{new Date(tx.investment_date).toLocaleDateString('vi-VN')}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          <div>
                            <span className="text-gray-500 dark:text-gray-400">{isWithdrawal ? t('amountReceived') : t('colAmount')}: </span>
                            <span className="font-medium text-gray-900 dark:text-gray-100">{fmt(tx.amount_vnd)}</span>
                          </div>
                          {isWithdrawal ? (
                            <div>
                              <span className="text-gray-500 dark:text-gray-400">{t('gainLoss')}: </span>
                              {gain != null ? (
                                <span className={`font-medium ${gain >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{gain >= 0 ? '+' : ''}{fmt(gain)}</span>
                              ) : <span className="text-gray-400">—</span>}
                            </div>
                          ) : (
                            <div>
                              <span className="text-gray-500 dark:text-gray-400">{rateOrNavLabel}: </span>
                              <span className="text-gray-700 dark:text-gray-300">{rateOrNav}</span>
                            </div>
                          )}
                          <div className="col-span-2">
                            <span className="text-gray-500 dark:text-gray-400">{t('colGoal')}: </span>
                            {tx.savings_goals?.goal_name
                              ? <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900">{tx.savings_goals.goal_name}</span>
                              : <span className="text-gray-400 dark:text-gray-500">{t('noGoal')}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 pt-0.5">
                          {!isWithdrawal && (
                            <button onClick={() => openEdit(tx)} className="h-8 w-8 p-0 flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                              <Edit className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                            </button>
                          )}
                          <button onClick={() => setConfirmTx(tx)} className="h-8 w-8 p-0 flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                            <Trash2 className="h-4 w-4 text-red-500 dark:text-red-400" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Desktop table layout */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-black/10 dark:border-gray-700 text-left">
                        <th className="px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colDate')}</th>
                        <th className="px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colAsset')}</th>
                        <th className="px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase text-right">{t('colAmount')}</th>
                        <th className="px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colGoal')}</th>
                        <th className="px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase text-center">{tc('actions')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5 dark:divide-gray-700">
                      {transactions.map((tx) => {
                        const isWithdrawal = tx.transaction_type === 'withdrawal'
                        const fundCode = tx.asset_type === 'fund' ? funds.find((f) => f.id === tx.fund_id)?.code : null
                        return (
                          <tr key={tx.transaction_id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                            <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">{new Date(tx.investment_date).toLocaleDateString('vi-VN')}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                {isWithdrawal ? (
                                  <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">{t('withdrawal')}</span>
                                ) : (
                                  <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${ASSET_COLORS[tx.asset_type as AssetType] ?? 'bg-gray-100 text-gray-700'}`}>
                                    {tx.asset_type ? t(`asset${tx.asset_type.charAt(0).toUpperCase() + tx.asset_type.slice(1)}` as 'assetFund' | 'assetBank' | 'assetStock' | 'assetGold') : '—'}
                                  </span>
                                )}
                                {fundCode && <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{fundCode}</span>}
                              </div>
                            </td>
                            <td className={`px-4 py-3 text-right font-medium whitespace-nowrap ${isWithdrawal ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'}`}>
                              {isWithdrawal ? '−' : '+'}{fmt(tx.amount_vnd)}
                            </td>
                            <td className="px-4 py-3">
                              {tx.savings_goals?.goal_name
                                ? <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900">{tx.savings_goals.goal_name}</span>
                                : <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400">{t('noGoal')}</span>}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <div className="flex items-center justify-center gap-1">
                                {!isWithdrawal && (
                                  <button onClick={() => openEdit(tx)} className="h-8 w-8 p-0 flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                                    <Edit className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                                  </button>
                                )}
                                <button onClick={() => setConfirmTx(tx)} className="h-8 w-8 p-0 flex items-center justify-center rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                                  <Trash2 className="h-4 w-4 text-red-500 dark:text-red-400" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-4 border-t border-black/10 dark:border-gray-700">
                    <p className="text-sm text-gray-600 dark:text-gray-400">{t('page')} {page} / {totalPages}</p>
                    <div className="flex gap-2">
                      <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                        className="h-9 px-3 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 transition-colors">
                        <ChevronLeft className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                      </button>
                      <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                        className="h-9 px-3 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 transition-colors">
                        <ChevronRight className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Import from Excel modal */}
        <Dialog open={showImport} onOpenChange={(o) => { if (!o) setShowImport(false) }}>
          <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t('importModalTitle')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-5 py-2">
              <div className="space-y-2">
                <Label htmlFor="ledger_import_fund">{t('assetFund')}</Label>
                <select
                  id="ledger_import_fund"
                  value={importFundId}
                  onChange={(e) => setImportFundId(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">{t('selectFund')}</option>
                  {funds.map((f) => <option key={f.id} value={f.id}>{f.code} - {f.name}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ledger_import_raw">{t('pasteFromExcel')}</Label>
                <p className="text-xs text-gray-400 dark:text-gray-500">Column order: Tháng | Tiền chuyển | Tiền mua (skip) | NAV mua | CCQ mua</p>
                <Textarea
                  id="ledger_import_raw"
                  value={importRaw}
                  onChange={(e) => handleImportPaste(e.target.value)}
                  rows={6}
                  placeholder={'7/2023\t10,000,000\t9,876,543\t23,375.28\t42.78\n8/2023\t10,000,000\t9,876,543\t24,100.00\t40.98'}
                  className="font-mono resize-none"
                />
              </div>
              {importRows.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
                    {t('importPreview', { valid: importRows.filter((r) => !r.error).length, total: importRows.length })}
                  </p>
                  <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-700 max-h-56 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 dark:bg-gray-800">
                        <tr>
                          {[t('colImportDate'), t('colImportAmount'), t('colImportNav'), t('colImportUnits'), t('colImportStatus')].map((h) => (
                            <th key={h} className="px-3 py-2 text-left font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                        {importRows.map((row, i) => (
                          <tr key={i} className={row.error ? 'bg-red-50 dark:bg-red-900/10' : ''}>
                            <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{row.investment_date || '—'}</td>
                            <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{isNaN(row.amount_vnd) ? '—' : Math.round(row.amount_vnd).toLocaleString('vi-VN')}</td>
                            <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{isNaN(row.unit_price) ? '—' : fmtNav(row.unit_price)}</td>
                            <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{isNaN(row.units) ? '—' : fmtUnits(row.units)}</td>
                            <td className="px-3 py-2">{row.error ? <span className="text-red-500 dark:text-red-400">{row.error}</span> : <span className="text-green-600 dark:text-green-400">✓</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowImport(false)}>{tc('cancel')}</Button>
              <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={handleImport} disabled={importing || !importFundId || importRows.filter((r) => !r.error).length === 0}>
                {importing ? t('importing') : t('importCount', { count: importRows.filter((r) => !r.error).length })}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Add / edit modal */}
        <Dialog open={!!formMode} onOpenChange={(o) => { if (!o) setFormMode(null) }}>
          <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{formMode === 'add' ? t('create') : tc('edit')}</DialogTitle>
            </DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); handleSave() }}>
              <div className="space-y-5 py-2">
                <div className="space-y-2">
                  <Label htmlFor="ledger_asset_type">{t('filterAssetType')} <span className="text-red-500">*</span></Label>
                  <Select value={txForm.asset_type} onValueChange={(value) => { if (value) setTxForm((f) => ({ ...f, asset_type: value, fund_id: '', unit_price: '', units: '', interest_rate: '', expiry_date: '' })) }}>
                    <SelectTrigger id="ledger_asset_type">
                      <SelectValue>{t(`asset${txForm.asset_type.charAt(0).toUpperCase() + txForm.asset_type.slice(1)}` as 'assetFund' | 'assetBank' | 'assetStock' | 'assetGold')}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {ASSET_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>{t(`asset${type.charAt(0).toUpperCase() + type.slice(1)}` as 'assetFund' | 'assetBank' | 'assetStock' | 'assetGold')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ledger_goal">{t('colGoal')}</Label>
                  <Select value={txForm.goal_id || 'unassigned'} onValueChange={(value) => { if (value) setTxForm((f) => ({ ...f, goal_id: value === 'unassigned' ? '' : value })) }}>
                    <SelectTrigger id="ledger_goal">
                      <SelectValue>{txForm.goal_id ? goals.find((g) => g.goal_id === txForm.goal_id)?.goal_name : t('noGoal')}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">{t('noGoal')}</SelectItem>
                      {goals.map((g) => <SelectItem key={g.goal_id} value={g.goal_id}>{g.goal_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {txForm.asset_type === 'fund' && (
                  <div className="space-y-2">
                    <Label htmlFor="ledger_fund">{t('assetFund')} <span className="text-red-500">*</span></Label>
                    <Select value={txForm.fund_id || undefined} onValueChange={(value) => { if (value) setTxForm((f) => ({ ...f, fund_id: value })) }}>
                      <SelectTrigger id="ledger_fund">
                        <SelectValue placeholder={t('selectFund')}>{txForm.fund_id ? funds.find((f) => f.id === txForm.fund_id)?.name : undefined}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {funds.map((f) => <SelectItem key={f.id} value={f.id}>{f.code} - {f.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="ledger_date">{t('colDate')} <span className="text-red-500">*</span></Label>
                  <Input id="ledger_date" type="date" value={txForm.investment_date} onChange={(e) => setTxForm((f) => ({ ...f, investment_date: e.target.value }))} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ledger_amount">{t('colAmount')} <span className="text-red-500">*</span></Label>
                  <AmountInput
                    id="ledger_amount"
                    value={txForm.amount_vnd}
                    onChange={(raw) => setTxForm((f) => ({ ...f, amount_vnd: raw }))}
                    placeholder="e.g. 10,000,000"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                  />
                </div>

                {txForm.asset_type === 'fund' && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="ledger_nav">{t('navAtBuy')} <span className="text-red-500">*</span></Label>
                      <DecimalInput id="ledger_nav" placeholder="e.g., 22,215.12" value={txForm.unit_price} onChange={(v) => setTxForm((f) => ({ ...f, unit_price: v }))}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ledger_units">{t('unitsFund')} <span className="text-red-500">*</span></Label>
                      <DecimalInput id="ledger_units" placeholder="e.g., 450.25" value={txForm.units} onChange={(v) => setTxForm((f) => ({ ...f, units: v }))}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm" />
                    </div>
                  </div>
                )}

                {txForm.asset_type !== 'bank' && txForm.asset_type !== 'fund' && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="ledger_price">{t('unitPrice')} <span className="text-red-500">*</span></Label>
                      <DecimalInput id="ledger_price" value={txForm.unit_price} onChange={(v) => setTxForm((f) => ({ ...f, unit_price: v }))}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ledger_qty">{txForm.asset_type === 'stock' ? t('unitsStock') : txForm.asset_type === 'gold' ? t('unitsGold') : t('unitsDefault')} <span className="text-red-500">*</span></Label>
                      <DecimalInput id="ledger_qty" value={txForm.units} onChange={(v) => setTxForm((f) => ({ ...f, units: v }))}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm" />
                    </div>
                  </div>
                )}

                {txForm.asset_type === 'bank' && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="ledger_rate">{t('colInterest')}</Label>
                      <Input id="ledger_rate" type="number" step="0.01" value={txForm.interest_rate} onChange={(e) => setTxForm((f) => ({ ...f, interest_rate: e.target.value }))} placeholder="e.g., 6.5" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ledger_expiry">{t('colExpiry')}</Label>
                      <Input id="ledger_expiry" type="date" value={txForm.expiry_date} onChange={(e) => setTxForm((f) => ({ ...f, expiry_date: e.target.value }))} />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="ledger_notes">{tc('notes')}</Label>
                  <Textarea id="ledger_notes" value={txForm.notes} onChange={(e) => setTxForm((f) => ({ ...f, notes: e.target.value }))} rows={3} placeholder="Additional notes..." className="resize-none" />
                </div>

                {formError && <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>}
              </div>

              <div className="flex gap-3">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setFormMode(null)}>{tc('cancel')}</Button>
                <Button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-700" disabled={saving}>{saving ? tc('saving') : tc('save')}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <ConfirmModal
          open={!!confirmTx}
          title={tc('delete')}
          message={confirmTx ? t('deleteMessage') : ''}
          confirming={deletingId === confirmTx?.transaction_id}
          onConfirm={() => confirmTx && handleDelete(confirmTx)}
          onCancel={() => setConfirmTx(null)}
        />
      </DialogContent>
    </Dialog>
  )
}
