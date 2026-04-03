'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Plus, Download, Edit, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import ConfirmModal from '@/app/components/ConfirmModal'

interface Transaction {
  transaction_id: string
  goal_id: string | null
  asset_type: string
  investment_date: string
  amount_vnd: number
  unit_price: number | null
  units: number | null
  interest_rate: number | null
  expiry_date: string | null
  fund_id: string | null
  notes: string | null
  savings_goals?: { goal_name: string } | null
  funds?: { id: string; name: string; nav: number } | { id: string; name: string; nav: number }[] | null
}

interface Goal {
  goal_id: string
  goal_name: string
}

interface Fund {
  id: string
  name: string
  code: string
  nav: number
}

const ASSET_TYPES = ['fund', 'bank', 'stock', 'gold'] as const
type AssetType = typeof ASSET_TYPES[number]


const ASSET_COLORS: Record<AssetType, string> = {
  fund: 'bg-purple-100 text-purple-700',
  bank: 'bg-blue-100 text-blue-700',
  stock: 'bg-green-100 text-green-700',
  gold: 'bg-amber-100 text-amber-700',
}

function calcCurrentValue(tx: Transaction): number {
  if (tx.asset_type === 'fund' && tx.units) {
    const fund = Array.isArray(tx.funds) ? tx.funds[0] : tx.funds
    return tx.units * (fund?.nav ?? tx.unit_price ?? 0)
  }
  if (!tx.interest_rate) return tx.amount_vnd
  const endMs = tx.expiry_date
    ? Math.min(Date.now(), new Date(tx.expiry_date).getTime())
    : Date.now()
  const days = Math.max(0, (endMs - new Date(tx.investment_date).getTime()) / 86400000)
  return tx.amount_vnd * Math.pow(1 + tx.interest_rate / 100, days / 365)
}

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')
const fmtNav = (n: number) => '₫ ' + n.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

interface ParsedRow {
  investment_date: string
  amount_vnd: number
  unit_price: number
  units: number
  error?: string
}

function parseExcelPaste(raw: string): ParsedRow[] {
  return raw.trim().split('\n')
    .map(line => line.split('\t'))
    .filter(cols => cols.length >= 5)
    .map(cols => {
      const raw0 = cols[0].trim()
      let investment_date = ''
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw0)) {
        // ISO date: 2023-07-15 → keep as-is
        investment_date = raw0
      } else {
        const parts = raw0.split('/')
        if (parts.length === 3) {
          // D/M/YYYY full date: 15/7/2023 → 2023-07-15
          const [d, m, y] = parts
          investment_date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
        } else if (parts.length === 2) {
          // M/YYYY month only: 7/2023 → 2023-07-01
          const [m, y] = parts
          investment_date = `${y}-${m.padStart(2, '0')}-01`
        }
      }
      const parseNum = (s: string) => parseFloat(s.replace(/,/g, '').trim())
      const amount_vnd = parseNum(cols[1])
      // cols[2] = Tiền mua — skip
      const unit_price = parseNum(cols[3])
      const units = parseNum(cols[4])
      const error = (!investment_date || isNaN(amount_vnd) || isNaN(unit_price) || isNaN(units))
        ? 'Cannot parse row' : undefined
      return { investment_date, amount_vnd, unit_price, units, error }
    })
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

export default function InvestmentTransactionsTab() {
  const t = useTranslations('transactions')
  const tc = useTranslations('common')
  const [transactions, setTransactions] = useState<Transaction[]>([])
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
  const [editTx, setEditTx] = useState<Transaction | null>(null)
  const [formMode, setFormMode] = useState<'add' | 'edit' | null>(null)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmTx, setConfirmTx] = useState<Transaction | null>(null)

  const [showImport, setShowImport] = useState(false)
  const [importFundId, setImportFundId] = useState('')
  const [importRaw, setImportRaw] = useState('')
  const [importRows, setImportRows] = useState<ParsedRow[]>([])
  const [importing, setImporting] = useState(false)
  const [importToast, setImportToast] = useState('')

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

  useEffect(() => { fetchGoals() }, [fetchGoals])
  useEffect(() => { fetchFunds() }, [fetchFunds])
  useEffect(() => { fetchTransactions() }, [fetchTransactions])

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

  function openEdit(tx: Transaction) {
    setTxForm({
      asset_type: tx.asset_type,
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
      const { inserted } = await res.json()
      setShowImport(false)
      setImportRaw('')
      setImportRows([])
      setImportFundId('')
      setImportToast(t('importedToast', { count: inserted }))
      setTimeout(() => setImportToast(''), 4000)
      await fetchTransactions()
    }
  }

  async function handleDelete(tx: Transaction) {
    setDeletingId(tx.transaction_id)
    const res = await fetch(`/api/v1/investment-transactions/${tx.transaction_id}`, { method: 'DELETE' })
    if (res.ok) {
      setConfirmTx(null)
      await fetchTransactions()
    }
    setDeletingId(null)
  }

  const totalPages = Math.max(1, Math.ceil(total / 20))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('title')}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('totalCount', { count: total })}</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => { setShowImport(true); setImportRaw(''); setImportRows([]); setImportFundId('') }}
            className="flex items-center gap-2 h-9 px-4 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <Download className="h-4 w-4" />
            {t('importFromExcel')}
          </button>
          <button
            onClick={openAdd}
            className="flex items-center gap-2 h-9 px-4 bg-gray-950 hover:bg-gray-800 text-white text-sm font-semibold rounded-md transition-colors"
          >
            <Plus className="h-4 w-4" />
            {t('create')}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-black/10 dark:border-gray-700 p-4">
        <div className="grid gap-4 md:grid-cols-4">
          <div>
            <label className="text-sm text-gray-600 dark:text-gray-400 mb-2 block">{t('filterAssetType')}</label>
            <select
              value={filters.asset_type}
              onChange={(e) => setSelectFilter('asset_type', e.target.value)}
              className="w-full border border-black/10 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-[#f3f3f5] dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">{t('filterAll')}</option>
              {ASSET_TYPES.map((type) => <option key={type} value={type}>{t(`asset${type.charAt(0).toUpperCase() + type.slice(1)}` as 'assetFund' | 'assetBank' | 'assetStock' | 'assetGold')}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-600 dark:text-gray-400 mb-2 block">{t('filterGoal')}</label>
            <select
              value={filters.goal_id}
              onChange={(e) => setSelectFilter('goal_id', e.target.value)}
              className="w-full border border-black/10 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-[#f3f3f5] dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">{t('allGoals')}</option>
              <option value="unassigned">{t('noGoal')}</option>
              {goals.map((g) => <option key={g.goal_id} value={g.goal_id}>{g.goal_name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm text-gray-600 dark:text-gray-400 mb-2 block">{t('filterFrom')}</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFilter('from_date', e.target.value, setDateFrom)}
              className="w-full border border-black/10 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-[#f3f3f5] dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <div>
            <label className="text-sm text-gray-600 dark:text-gray-400 mb-2 block">{t('filterTo')}</label>
            <input type="date" value={dateTo} onChange={(e) => setDateFilter('to_date', e.target.value, setDateTo)}
              className="w-full border border-black/10 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-[#f3f3f5] dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
        </div>
        <div className="flex justify-end mt-4">
          <button onClick={resetFilters} className="h-8 px-3 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">{tc('reset')}</button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-black/10 dark:border-gray-700 overflow-hidden">
        {loading ? (
          <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">{tc('loading')}</div>
        ) : transactions.length === 0 ? (
          <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">{t('empty')}</div>
        ) : (
          <div className="overflow-x-auto p-6">
            <table className="w-full">
              <thead>
                <tr className="border-b border-black/10 dark:border-gray-700 text-left">
                  <th className="px-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colDate')}</th>
                  <th className="px-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colAsset')}</th>
                  <th className="px-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase text-right">{t('colAmount')}</th>
                  <th className="px-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase text-right">{t('colTransaction')}</th>
                  <th className="px-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase text-right">{t('colInterest')}</th>
                  <th className="px-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase text-right">{t('colExpiry')}</th>
                  <th className="px-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colGoal')}</th>
                  <th className="px-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colNotes')}</th>
                  <th className="px-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{tc('actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5 dark:divide-gray-700">
                {transactions.map((tx) => {
                  const currentValue = calcCurrentValue(tx)
                  const rateOrNav = tx.asset_type === 'fund'
                    ? (tx.unit_price != null ? fmtNav(tx.unit_price) : '—')
                    : (tx.interest_rate != null ? `${tx.interest_rate}%` : '—')
                  return (
                    <tr key={tx.transaction_id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{new Date(tx.investment_date).toLocaleDateString('vi-VN')}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ASSET_COLORS[tx.asset_type as AssetType] ?? 'bg-gray-100 text-gray-700'}`}>
                          {t(`asset${tx.asset_type.charAt(0).toUpperCase() + tx.asset_type.slice(1)}` as 'assetFund' | 'assetBank' | 'assetStock' | 'assetGold') ?? tx.asset_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-gray-100">{fmt(tx.amount_vnd)}</td>
                      <td className="px-4 py-3 text-right text-sm text-gray-600 dark:text-gray-400">{tx.units ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-sm text-gray-600 dark:text-gray-400">{rateOrNav}</td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-gray-100">{fmt(currentValue)}</td>
                      <td className="px-4 py-3">
                        {tx.savings_goals?.goal_name
                          ? <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900">{tx.savings_goals.goal_name}</span>
                          : <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">{t('noGoal')}</span>
                        }
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 max-w-32 truncate">{tx.notes ?? '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEdit(tx)} className="p-1.5 rounded-md text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
                            <Edit className="h-4 w-4" />
                          </button>
                          <button onClick={() => setConfirmTx(tx)} className="p-1.5 rounded-md text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-black/10 dark:border-gray-700">
              <p className="text-sm text-gray-600 dark:text-gray-400">{t('page')} {page} / {totalPages}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-1.5 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 transition-colors"
                >
                  <ChevronLeft className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-1.5 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40 transition-colors"
                >
                  <ChevronRight className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Toast */}
      {importToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg z-50">
          {importToast}
        </div>
      )}

      {/* Import from Excel Modal */}
      {showImport && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('importModalTitle')}</h3>
              <button
                onClick={() => setShowImport(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('assetFund')}</label>
                <select
                  value={importFundId}
                  onChange={(e) => setImportFundId(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">{t('selectFund')}</option>
                  {funds.map((f) => (
                    <option key={f.id} value={f.id}>{f.code} - {f.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  {t('pasteFromExcel')}
                </label>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
                  Column order: Tháng | Tiền chuyển | Tiền mua (skip) | NAV mua | CCQ mua
                </p>
                <textarea
                  value={importRaw}
                  onChange={(e) => handleImportPaste(e.target.value)}
                  rows={6}
                  placeholder={"7/2023\t10,000,000\t9,876,543\t23,375.28\t42.78\n8/2023\t10,000,000\t9,876,543\t24,100.00\t40.98"}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm font-mono bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>

              {importRows.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
                    {t('importPreview', { valid: importRows.filter((r) => !r.error).length, total: importRows.length })}
                  </p>
                  <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-700">
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
                            <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{isNaN(row.unit_price) ? '—' : row.unit_price.toLocaleString('vi-VN')}</td>
                            <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{isNaN(row.units) ? '—' : row.units}</td>
                            <td className="px-3 py-2">
                              {row.error
                                ? <span className="text-red-500 dark:text-red-400">{row.error}</span>
                                : <span className="text-green-600 dark:text-green-400">✓</span>
                              }
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-700">
              <button
                onClick={() => setShowImport(false)}
                className="flex-1 px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                {tc('cancel')}
              </button>
              <button
                onClick={handleImport}
                disabled={importing || !importFundId || importRows.filter((r) => !r.error).length === 0}
                className="flex-1 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {importing ? t('importing') : t('importCount', { count: importRows.filter((r) => !r.error).length })}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {formMode && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <form onSubmit={(e) => { e.preventDefault(); handleSave() }} className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {formMode === 'add' ? t('create') : tc('edit')}
              </h3>
              <button
                type="button"
                onClick={() => setFormMode(null)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* Asset Type */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('filterAssetType')}</label>
                <select
                  value={txForm.asset_type}
                  onChange={(e) => setTxForm((f) => ({ ...f, asset_type: e.target.value, fund_id: '', unit_price: '', units: '', interest_rate: '', expiry_date: '' }))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {ASSET_TYPES.map((type) => (
                    <option key={type} value={type}>{t(`asset${type.charAt(0).toUpperCase() + type.slice(1)}` as 'assetFund' | 'assetBank' | 'assetStock' | 'assetGold')}</option>
                  ))}
                </select>
              </div>

              {/* Goal */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('colGoal')}</label>
                <select
                  value={txForm.goal_id}
                  onChange={(e) => setTxForm((f) => ({ ...f, goal_id: e.target.value }))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">{t('noGoal')}</option>
                  {goals.map((g) => (
                    <option key={g.goal_id} value={g.goal_id}>{g.goal_name}</option>
                  ))}
                </select>
              </div>

              {/* Fund picker — only for fund type */}
              {txForm.asset_type === 'fund' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('assetFund')}</label>
                  <select
                    value={txForm.fund_id}
                    onChange={(e) => setTxForm((f) => ({ ...f, fund_id: e.target.value }))}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">{t('selectFund')}</option>
                    {funds.map((f) => (
                      <option key={f.id} value={f.id}>{f.code} - {f.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Date */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('colDate')}</label>
                <input
                  type="date"
                  value={txForm.investment_date}
                  onChange={(e) => setTxForm((f) => ({ ...f, investment_date: e.target.value }))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Amount */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('colAmount')}</label>
                <input
                  type="number"
                  value={txForm.amount_vnd}
                  onChange={(e) => setTxForm((f) => ({ ...f, amount_vnd: e.target.value }))}
                  placeholder="VD: 10000000"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Unit Price + Units — non-bank */}
              {txForm.asset_type !== 'bank' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      {txForm.asset_type === 'fund' ? t('navAtBuy') : t('unitPrice')}
                    </label>
                    <input
                      type="number"
                      value={txForm.unit_price}
                      onChange={(e) => setTxForm((f) => ({ ...f, unit_price: e.target.value }))}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{txForm.asset_type === 'fund' ? t('unitsFund') : txForm.asset_type === 'stock' ? t('unitsStock') : txForm.asset_type === 'gold' ? t('unitsGold') : t('unitsDefault')}</label>
                    <input
                      type="number"
                      value={txForm.units}
                      onChange={(e) => setTxForm((f) => ({ ...f, units: e.target.value }))}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              )}

              {/* Interest Rate + Expiry — bank only */}
              {txForm.asset_type === 'bank' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('colInterest')}</label>
                    <input
                      type="number"
                      step="0.01"
                      value={txForm.interest_rate}
                      onChange={(e) => setTxForm((f) => ({ ...f, interest_rate: e.target.value }))}
                      placeholder="VD: 6.5"
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{t('colExpiry')}</label>
                    <input
                      type="date"
                      value={txForm.expiry_date}
                      onChange={(e) => setTxForm((f) => ({ ...f, expiry_date: e.target.value }))}
                      className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{tc('notes')}</label>
                <input
                  type="text"
                  value={txForm.notes}
                  onChange={(e) => setTxForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {formError && (
                <p className="text-sm text-red-600 dark:text-red-400">{formError}</p>
              )}
            </div>

            <div className="flex gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-700">
              <button
                type="button"
                onClick={() => setFormMode(null)}
                className="flex-1 px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                {tc('cancel')}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {saving ? tc('saving') : tc('save')}
              </button>
            </div>
          </form>
        </div>
      )}

      {confirmTx && (
        <ConfirmModal
          title={tc('delete')}
          message={t('deleteMessage')}
          confirming={deletingId === confirmTx.transaction_id}
          onConfirm={() => handleDelete(confirmTx)}
          onCancel={() => setConfirmTx(null)}
        />
      )}
    </div>
  )
}
