'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

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

type SortKey = 'name' | 'code' | 'fund_type'

const FUND_TYPE_KEYS: Record<FundType, string> = {
  balanced: 'typeBalanced',
  equity: 'typeEquity',
  debt: 'typeDebt',
  gold: 'typeGold',
}

const FUND_TYPE_COLORS: Record<FundType, string> = {
  balanced: 'bg-purple-100 text-purple-700',
  equity: 'bg-green-100 text-green-700',
  debt: 'bg-blue-100 text-blue-700',
  gold: 'bg-amber-100 text-amber-700',
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
  const [formIsDca, setFormIsDca] = useState(false)
  const [formDcaAmount, setFormDcaAmount] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

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

  const sortedFunds = [...funds].sort((a, b) =>
    a[sortBy].toString().localeCompare(b[sortBy].toString())
  )

  function openAddModal() {
    setFormName('')
    setFormCode('')
    setFormType('')
    setFormNav('')
    setFormNavUrl('')
    setFormIsDca(false)
    setFormDcaAmount('')
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
    setFormIsDca(fund.is_dca)
    setFormDcaAmount(fund.dca_monthly_amount_vnd ? String(fund.dca_monthly_amount_vnd) : '')
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
        body: JSON.stringify({
          name: formName.trim(),
          code: formCode.trim(),
          fund_type: formType,
          nav: navNum,
          nav_source_url: formNavUrl.trim() || null,
          is_dca: formIsDca,
          dca_monthly_amount_vnd: formIsDca && formDcaAmount ? Number(formDcaAmount) : null,
        }),
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
      onClick={() => setSortBy(col)}
      className={`text-left font-semibold text-sm ${sortBy === col ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-600 dark:text-gray-400'}`}
    >
      {label} {sortBy === col && '↑'}
    </button>
  )

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950 px-4 py-8 sm:px-8">
      {/* Toasts */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`px-4 py-2 rounded shadow text-sm text-white ${t.type === 'error' ? 'bg-red-600' : 'bg-green-600'}`}
          >
            {t.message}
          </div>
        ))}
      </div>

      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('desc')}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleRefreshNav}
              disabled={refreshing || !funds.some(f => f.nav_source_url)}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {refreshing ? t('refreshingNav') : t('refreshNav')}
            </button>
            <button
              onClick={openAddModal}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded transition-colors"
            >
              {t('add')}
            </button>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow overflow-hidden">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex gap-4 p-4 border-b border-gray-100 dark:border-gray-700 animate-pulse">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded flex-1" />
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-20" />
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-16" />
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-16" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow p-8 text-center border border-gray-100 dark:border-gray-700">
            <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
            <button
              onClick={() => loadFunds()}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded hover:bg-indigo-700 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : funds.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow p-16 text-center border border-gray-100 dark:border-gray-700">
            <div className="text-5xl mb-4">📚</div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">{t('empty')}</h2>
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
              {t('emptyDesc')}
            </p>
            <button
              onClick={openAddModal}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded hover:bg-indigo-700 transition-colors"
            >
              {t('add')}
            </button>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block bg-white dark:bg-gray-900 rounded-lg shadow overflow-x-auto border border-gray-100 dark:border-gray-700">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left"><SortButton col="name" label={t('colName')} /></th>
                    <th className="px-4 py-3 text-left"><SortButton col="code" label={t('colCode')} /></th>
                    <th className="px-4 py-3 text-left"><SortButton col="fund_type" label={t('colType')} /></th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600 dark:text-gray-400">{t('colNav')}</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600 dark:text-gray-400">{tc('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedFunds.map((fund) => (
                    <tr key={fund.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">
                        <span>{fund.name}</span>
                        {fund.is_dca && (
                          <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 font-medium">DCA</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm font-mono text-gray-500 dark:text-gray-400">{fund.code}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-1 rounded font-medium ${FUND_TYPE_COLORS[fund.fund_type]}`}>
                          {t(FUND_TYPE_KEYS[fund.fund_type])}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">
                        <span>{fund.nav.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        {fund.nav_source_url && fund.updated_at && (
                          <span className="text-xs text-gray-400 ml-1">{formatRelativeDate(fund.updated_at)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => openEditModal(fund)}
                            className="text-xs px-3 py-1 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
                          >
                            {tc('edit')}
                          </button>
                          <button
                            onClick={() => setDeleteTarget(fund)}
                            className="text-xs px-3 py-1 border border-red-200 dark:border-red-800 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 transition-colors"
                          >
                            {tc('delete')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile card list */}
            <div className="md:hidden flex flex-col gap-3">
              {sortedFunds.map((fund) => (
                <div key={fund.id} className="bg-white dark:bg-gray-900 rounded-lg shadow p-4 border border-gray-100 dark:border-gray-700">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{fund.name}</p>
                        {fund.is_dca && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 font-medium">DCA</span>
                        )}
                      </div>
                      <p className="text-xs font-mono text-gray-500 dark:text-gray-400">{fund.code}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded font-medium ${FUND_TYPE_COLORS[fund.fund_type]}`}>
                      {t(FUND_TYPE_KEYS[fund.fund_type])}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
                    NAV: <span className="font-medium">{fund.nav.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    {fund.nav_source_url && fund.updated_at && (
                      <span className="text-xs text-gray-400 ml-1">{formatRelativeDate(fund.updated_at)}</span>
                    )}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => openEditModal(fund)}
                      className="flex-1 text-xs px-3 py-2 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
                    >
                      {tc('edit')}
                    </button>
                    <button
                      onClick={() => setDeleteTarget(fund)}
                      className="flex-1 text-xs px-3 py-2 border border-red-200 dark:border-red-800 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 transition-colors"
                    >
                      {tc('delete')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Add/Edit Modal */}
      {modalMode && (
        <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4">
          <form onSubmit={(e) => { e.preventDefault(); handleSave() }} className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-md p-6 border border-gray-100 dark:border-gray-700">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">
              {modalMode === 'add' ? t('addModal') : t('editModal')}
            </h2>
            {formError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded border border-red-200 dark:border-red-800">{formError}</div>
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
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
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
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('typeLabel')}</label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value as FundType)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
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
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('navSourceLabel')}</label>
                <input
                  type="url"
                  value={formNavUrl}
                  onChange={(e) => setFormNavUrl(e.target.value)}
                  placeholder="e.g., https://www.vcbf.com/quy-trai-phieu"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                />
              </div>
              <div className="flex items-center justify-between py-1">
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">DCA</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">Auto-add fixed amount each month</p>
                </div>
                <button
                  type="button"
                  onClick={() => setFormIsDca((v) => !v)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 ${formIsDca ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'}`}
                >
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${formIsDca ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
              {formIsDca && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Monthly DCA Amount (₫)</label>
                  <input
                    type="number"
                    value={formDcaAmount}
                    onChange={(e) => setFormDcaAmount(e.target.value)}
                    min="1"
                    step="1"
                    placeholder="e.g., 5000000"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                  />
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={closeModal}
                disabled={saving}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                {tc('cancel')}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
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
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-sm p-6 border border-gray-100 dark:border-gray-700">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">{t('deleteModal', { name: deleteTarget.name })}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{t('deleteCannotUndo')}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                {tc('cancel')}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
              >
                {deleting ? tc('deleting') : tc('delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
