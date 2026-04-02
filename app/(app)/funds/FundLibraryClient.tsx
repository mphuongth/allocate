'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Plus, Edit, Trash2, RefreshCw, ArrowUpDown, Info } from 'lucide-react'

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

type SortKey = 'name' | 'code' | 'fund_type' | 'nav'

const FUND_TYPE_KEYS: Record<FundType, string> = {
  balanced: 'typeBalanced',
  equity: 'typeEquity',
  debt: 'typeDebt',
  gold: 'typeGold',
}

const FUND_TYPE_COLORS: Record<FundType, string> = {
  balanced: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  equity: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  debt: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  gold: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
}

let toastId = 0

const FUNDS_CACHE_KEY = 'fundLibraryCache'
const CACHE_TTL = 2 * 60 * 1000
function getFundsCache(): Fund[] | null {
  try {
    const raw = localStorage.getItem(FUNDS_CACHE_KEY)
    if (!raw) return null
    const { data, ts } = JSON.parse(raw)
    if (Date.now() - ts > CACHE_TTL) return null
    return data
  } catch { return null }
}
function setFundsCache(data: Fund[]) {
  try { localStorage.setItem(FUNDS_CACHE_KEY, JSON.stringify({ data, ts: Date.now() })) } catch {}
}
function bustFundsCache() {
  try { localStorage.removeItem(FUNDS_CACHE_KEY) } catch {}
}

export default function FundLibraryClient() {
  const t = useTranslations('funds')
  const tc = useTranslations('common')
  const [funds, setFunds] = useState<Fund[]>(() => getFundsCache() ?? [])
  const [loading, setLoading] = useState(() => !getFundsCache())
  const [error, setError] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<SortKey>('name')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [searchQuery, setSearchQuery] = useState('')

  // Modal state
  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null)
  const [selectedFund, setSelectedFund] = useState<Fund | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Fund | null>(null)

  // Form state
  const [formName, setFormName] = useState('')
  const [formCode, setFormCode] = useState('')
  const [formType, setFormType] = useState<FundType | ''>('')
  const [formNav, setFormNav] = useState('')
  const [formNavUrl, setFormNavUrl] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // Inline DCA state
  const [dcaAmountEditId, setDcaAmountEditId] = useState<string | null>(null)
  const [dcaAmountEditValue, setDcaAmountEditValue] = useState('')
  const [togglingDcaIds, setTogglingDcaIds] = useState<Set<string>>(new Set())

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = ++toastId
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000)
  }, [])

  const loadFunds = useCallback(async (opts?: { force?: boolean }) => {
    if (opts?.force) bustFundsCache()
    setError(null)
    try {
      const res = await fetch('/api/funds')
      if (!res.ok) throw new Error('Failed to load funds')
      const data = await res.json()
      setFundsCache(data.funds)
      setFunds(data.funds)
    } catch {
      setError('Failed to load funds. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadFunds()
  }, [loadFunds])

  const handleSort = (col: SortKey) => {
    if (sortBy === col) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(col)
      setSortOrder('asc')
    }
  }

  const filteredFunds = funds.filter(fund =>
    fund.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    fund.code.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const sortedFunds = [...filteredFunds].sort((a, b) => {
    let cmp = 0
    if (sortBy === 'nav') {
      cmp = a.nav - b.nav
    } else {
      cmp = a[sortBy].toString().localeCompare(b[sortBy].toString())
    }
    return sortOrder === 'asc' ? cmp : -cmp
  })

  function openAddModal() {
    setFormName('')
    setFormCode('')
    setFormType('')
    setFormNav('')
    setFormNavUrl('')
    setFormError(null)
    setSelectedFund(null)
    setModalMode('add')
  }

  function openEditModal(fund: Fund) {
    setFormName(fund.name)
    setFormCode(fund.code)
    setFormType(fund.fund_type)
    setFormNav(String(fund.nav))
    setFormNavUrl(fund.nav_source_url ?? '')
    setFormError(null)
    setSelectedFund(fund)
    setModalMode('edit')
  }

  function closeModal() {
    setModalMode(null)
    setSelectedFund(null)
    setFormError(null)
  }

  async function handleSave() {
    setFormError(null)
    if (!formName.trim()) { setFormError(t('nameRequired')); return }
    if (!formCode.trim()) { setFormError(t('codeRequired')); return }
    if (!formType) { setFormError(t('typeRequired')); return }
    const navNum = Number(formNav)
    if (!formNav || isNaN(navNum) || navNum < 0.01) {
      setFormError(t('navRequired'))
      return
    }

    setSaving(true)
    try {
      const url = modalMode === 'edit' ? `/api/funds/${selectedFund!.id}` : '/api/funds'
      const method = modalMode === 'edit' ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formName.trim(), code: formCode.trim(), fund_type: formType, nav: navNum, nav_source_url: formNavUrl.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 409) {
          setFormError(t('codeExists'))
        } else {
          setFormError(data.error || t('error'))
        }
        return
      }
      closeModal()
      bustFundsCache()
      await loadFunds({ force: true })
      addToast(modalMode === 'edit' ? 'Fund updated' : 'Fund added')
    } catch {
      setFormError('Something went wrong. Please try again later.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/funds/${deleteTarget.id}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 204) throw new Error()
      setDeleteTarget(null)
      bustFundsCache()
      await loadFunds({ force: true })
      addToast('Fund deleted')
    } catch {
      addToast('Failed to delete fund. Please try again.', 'error')
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  async function handleRefreshNav() {
    setRefreshing(true)
    try {
      const res = await fetch('/api/v1/funds/refresh-nav', { method: 'POST' })
      const { results } = await res.json()
      const updated = results.filter((r: { nav?: number }) => r.nav !== undefined).length
      const failed = results.filter((r: { error?: string }) => r.error).length
      bustFundsCache()
      await loadFunds({ force: true })
      addToast(
        `${updated} updated${failed ? `, ${failed} failed` : ''}`,
        failed > 0 && updated === 0 ? 'error' : 'success'
      )
    } catch {
      addToast('Failed to refresh NAV. Please try again.', 'error')
    } finally {
      setRefreshing(false)
    }
  }

  async function handleToggleDca(fund: Fund) {
    const turningOn = !fund.is_dca
    setFunds((prev) => prev.map((f) => f.id === fund.id ? { ...f, is_dca: turningOn, dca_monthly_amount_vnd: turningOn ? f.dca_monthly_amount_vnd : null } : f))

    if (turningOn) {
      setDcaAmountEditId(fund.id)
      setDcaAmountEditValue('')
      return
    }

    setTogglingDcaIds((prev) => new Set([...prev, fund.id]))
    try {
      const res = await fetch(`/api/funds/${fund.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fund.name, code: fund.code, fund_type: fund.fund_type, nav: fund.nav, nav_source_url: fund.nav_source_url, is_dca: false, dca_monthly_amount_vnd: null }),
      })
      if (!res.ok) throw new Error()
      bustFundsCache()
      await loadFunds({ force: true })
    } catch {
      setFunds((prev) => prev.map((f) => f.id === fund.id ? { ...f, is_dca: true } : f))
      addToast('Failed to update DCA', 'error')
    } finally {
      setTogglingDcaIds((prev) => { const s = new Set(prev); s.delete(fund.id); return s })
    }
  }

  async function handleSaveDcaAmount(fund: Fund) {
    const amount = Number(dcaAmountEditValue)
    const valid = dcaAmountEditValue !== '' && !isNaN(amount) && amount > 0

    if (!valid) {
      setFunds((prev) => prev.map((f) => f.id === fund.id ? { ...f, is_dca: false, dca_monthly_amount_vnd: null } : f))
      setDcaAmountEditId(null)
      return
    }

    setDcaAmountEditId(null)
    setTogglingDcaIds((prev) => new Set([...prev, fund.id]))
    try {
      const res = await fetch(`/api/funds/${fund.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fund.name, code: fund.code, fund_type: fund.fund_type, nav: fund.nav, nav_source_url: fund.nav_source_url, is_dca: true, dca_monthly_amount_vnd: amount }),
      })
      if (!res.ok) throw new Error()
      bustFundsCache()
      await loadFunds({ force: true })
    } catch {
      setFunds((prev) => prev.map((f) => f.id === fund.id ? { ...f, is_dca: false, dca_monthly_amount_vnd: null } : f))
      addToast('Failed to update DCA', 'error')
    } finally {
      setTogglingDcaIds((prev) => { const s = new Set(prev); s.delete(fund.id); return s })
    }
  }

  function formatRelativeDate(dateStr: string): string {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    return `${diffDays}d ago`
  }

  const SortButton = ({ col, label }: { col: SortKey; label: string }) => (
    <button
      onClick={() => handleSort(col)}
      className={`flex items-center gap-1.5 text-xs font-medium uppercase hover:text-gray-700 dark:hover:text-gray-200 transition-colors ${
        sortBy === col ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-500 dark:text-gray-400'
      }`}
    >
      {label}
      <ArrowUpDown className={`h-3 w-3 ${sortBy === col ? 'opacity-100' : 'opacity-50'}`} />
    </button>
  )

  return (
    <div className="space-y-6">
      {/* Toasts */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`px-4 py-2 rounded-lg shadow-lg text-sm text-white ${t.type === 'error' ? 'bg-red-600' : 'bg-green-600'}`}
          >
            {t.message}
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{t('title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('desc')}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleRefreshNav}
            disabled={refreshing || !funds.some(f => f.nav_source_url)}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? t('refreshingNav') : t('refreshNav')}
          </button>
          <button
            onClick={openAddModal}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="h-4 w-4" />
            {t('add')}
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center gap-4">
          <input
            type="text"
            placeholder="Search by fund name or code..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 max-w-md px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <span className="text-sm text-gray-500 dark:text-gray-400">{filteredFunds.length} funds</span>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-6 py-4 border-b border-gray-100 dark:border-gray-700 last:border-0 animate-pulse">
              <div className="h-10 w-10 bg-gray-200 dark:bg-gray-700 rounded-lg flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-40" />
                <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-24" />
              </div>
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-16" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-24" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-12 text-center">
          <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
          <button
            onClick={() => loadFunds()}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : funds.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-16 text-center">
          <div className="text-5xl mb-4">📚</div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">{t('empty')}</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">{t('emptyDesc')}</p>
          <button
            onClick={openAddModal}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
          >
            {t('add')}
          </button>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="px-6 py-4 text-left"><SortButton col="name" label={t('colName')} /></th>
                    <th className="px-6 py-4 text-left"><SortButton col="code" label={t('colCode')} /></th>
                    <th className="px-6 py-4 text-left"><SortButton col="fund_type" label={t('colType')} /></th>
                    <th className="px-6 py-4 text-right">
                      <div className="flex justify-end"><SortButton col="nav" label={t('colNav')} /></div>
                    </th>
                    <th className="px-6 py-4 text-left">
                      <span className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">DCA</span>
                    </th>
                    <th className="px-6 py-4 text-right">
                      <span className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">{tc('actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {sortedFunds.map((fund) => (
                    <tr key={fund.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 text-sm font-semibold">
                            {fund.code.substring(0, 2)}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">{fund.name}</p>
                            {fund.nav_source_url && fund.updated_at && (
                              <p className="text-xs text-gray-400 mt-0.5">Updated {formatRelativeDate(fund.updated_at)}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <code className="text-xs font-mono text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                          {fund.code}
                        </code>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-xs px-2 py-1 rounded font-medium ${FUND_TYPE_COLORS[fund.fund_type]}`}>
                          {t(FUND_TYPE_KEYS[fund.fund_type])}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {fund.nav.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleToggleDca(fund)}
                            disabled={togglingDcaIds.has(fund.id)}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${fund.is_dca ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'}`}
                          >
                            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform ${fund.is_dca ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                          </button>
                          {fund.is_dca && dcaAmountEditId === fund.id ? (
                            <input
                              autoFocus
                              type="number"
                              min="1"
                              step="1"
                              value={dcaAmountEditValue}
                              onChange={(e) => setDcaAmountEditValue(e.target.value)}
                              onBlur={() => handleSaveDcaAmount(fund)}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveDcaAmount(fund); if (e.key === 'Escape') { setFunds((prev) => prev.map((f) => f.id === fund.id ? { ...f, is_dca: false } : f)); setDcaAmountEditId(null) } }}
                              placeholder="Amount ₫"
                              className="w-28 px-2 py-0.5 text-xs border border-indigo-300 dark:border-indigo-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                          ) : fund.is_dca && fund.dca_monthly_amount_vnd ? (
                            <button
                              type="button"
                              onClick={() => { setDcaAmountEditId(fund.id); setDcaAmountEditValue(String(fund.dca_monthly_amount_vnd)) }}
                              className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                            >
                              {fund.dca_monthly_amount_vnd.toLocaleString('vi-VN')}₫
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openEditModal(fund)}
                            className="p-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 transition-colors"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(fund)}
                            className="p-2 rounded-lg border border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 dark:text-red-400 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {sortedFunds.length === 0 && searchQuery && (
              <div className="py-12 text-center">
                <p className="text-gray-500 dark:text-gray-400">No funds found matching &ldquo;{searchQuery}&rdquo;.</p>
              </div>
            )}
          </div>

          {/* Mobile card list */}
          <div className="md:hidden flex flex-col gap-3">
            {sortedFunds.map((fund) => (
              <div key={fund.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-start gap-3 mb-3">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 text-sm font-semibold">
                    {fund.code.substring(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{fund.name}</p>
                    <p className="text-xs font-mono text-gray-500 dark:text-gray-400">{fund.code}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded font-medium flex-shrink-0 ${FUND_TYPE_COLORS[fund.fund_type]}`}>
                    {t(FUND_TYPE_KEYS[fund.fund_type])}
                  </span>
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
                  NAV: <span className="font-semibold">{fund.nav.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  {fund.nav_source_url && fund.updated_at && (
                    <span className="text-xs text-gray-400 ml-1">· {formatRelativeDate(fund.updated_at)}</span>
                  )}
                </p>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs text-gray-500 dark:text-gray-400">DCA</span>
                  <button
                    type="button"
                    onClick={() => handleToggleDca(fund)}
                    disabled={togglingDcaIds.has(fund.id)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${fund.is_dca ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transform transition-transform ${fund.is_dca ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
                  </button>
                  {fund.is_dca && dcaAmountEditId === fund.id ? (
                    <input
                      autoFocus
                      type="number"
                      min="1"
                      step="1"
                      value={dcaAmountEditValue}
                      onChange={(e) => setDcaAmountEditValue(e.target.value)}
                      onBlur={() => handleSaveDcaAmount(fund)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSaveDcaAmount(fund); if (e.key === 'Escape') { setFunds((prev) => prev.map((f) => f.id === fund.id ? { ...f, is_dca: false } : f)); setDcaAmountEditId(null) } }}
                      placeholder="Amount ₫"
                      className="w-28 px-2 py-0.5 text-xs border border-indigo-300 dark:border-indigo-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  ) : fund.is_dca && fund.dca_monthly_amount_vnd ? (
                    <button
                      type="button"
                      onClick={() => { setDcaAmountEditId(fund.id); setDcaAmountEditValue(String(fund.dca_monthly_amount_vnd)) }}
                      className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      {fund.dca_monthly_amount_vnd.toLocaleString('vi-VN')}₫
                    </button>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => openEditModal(fund)}
                    className="flex-1 flex items-center justify-center gap-1.5 text-xs px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
                  >
                    <Edit className="h-3.5 w-3.5" />
                    {tc('edit')}
                  </button>
                  <button
                    onClick={() => setDeleteTarget(fund)}
                    className="flex-1 flex items-center justify-center gap-1.5 text-xs px-3 py-2 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {tc('delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* NAV Info */}
      <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/50 rounded-xl">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-500 text-white">
          <Info className="h-4 w-4" />
        </div>
        <div>
          <h4 className="font-medium text-blue-900 dark:text-blue-300 text-sm mb-1">About NAV Updates</h4>
          <p className="text-sm text-blue-800 dark:text-blue-400">
            NAV (Net Asset Value) is updated daily by fund providers. Click &ldquo;{t('refreshNav')}&rdquo; to fetch the latest prices.
            Prices are typically updated after market close.
          </p>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {modalMode && (
        <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4">
          <form onSubmit={(e) => { e.preventDefault(); handleSave() }} className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-6 border border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">
              {modalMode === 'add' ? t('addModal') : t('editModal')}
            </h2>
            {formError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded-lg border border-red-200 dark:border-red-800">{formError}</div>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('nameLabel')}</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  maxLength={255}
                  placeholder="e.g., Vanguard S&P 500 ETF"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('codeLabel')}</label>
                  <input
                    type="text"
                    value={formCode}
                    onChange={(e) => setFormCode(e.target.value.toUpperCase())}
                    maxLength={50}
                    placeholder="e.g., VOO"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('typeLabel')}</label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value as FundType)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                  >
                    <option value="">{t('selectType')}</option>
                    {(Object.keys(FUND_TYPE_KEYS) as FundType[]).map((type) => (
                      <option key={type} value={type}>{t(FUND_TYPE_KEYS[type])}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('navLabel')}</label>
                <input
                  type="number"
                  value={formNav}
                  onChange={(e) => setFormNav(e.target.value)}
                  min="0.01"
                  step="0.01"
                  placeholder="e.g., 450.25"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('navSourceLabel')}</label>
                <input
                  type="url"
                  value={formNavUrl}
                  onChange={(e) => setFormNavUrl(e.target.value)}
                  placeholder="e.g., https://www.vcbf.com/quy-trai-phieu"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={closeModal}
                disabled={saving}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                {tc('cancel')}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {saving ? tc('saving') : t('saveBtn')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm p-6 border border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">{t('deleteModal', { name: deleteTarget.name })}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{t('deleteCannotUndo')}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                {tc('cancel')}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {deleting ? tc('deleting') : tc('delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
