'use client'

import { useCallback, useEffect, useState } from 'react'

type FundType = 'balanced' | 'equity' | 'debt' | 'gold'

type Fund = {
  id: string
  name: string
  code: string
  fund_type: FundType
  nav: number
  nav_source_url: string | null
  created_at: string
  updated_at: string
}

type Toast = { id: number; message: string; type: 'success' | 'error' }

type SortKey = 'name' | 'code' | 'fund_type'

const FUND_TYPE_LABELS: Record<FundType, string> = {
  balanced: 'Balanced',
  equity: 'Equity',
  debt: 'Debt',
  gold: 'Gold',
}

const FUND_TYPE_COLORS: Record<FundType, string> = {
  balanced: 'bg-purple-100 text-purple-700',
  equity: 'bg-green-100 text-green-700',
  debt: 'bg-blue-100 text-blue-700',
  gold: 'bg-amber-100 text-amber-700',
}

let toastId = 0

export default function FundLibraryClient() {
  const [funds, setFunds] = useState<Fund[]>([])
  const [loading, setLoading] = useState(true)
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

  const loadFunds = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/funds')
      if (!res.ok) throw new Error('Failed to load funds')
      const data = await res.json()
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
    if (!formName.trim()) { setFormError('Name is required.'); return }
    if (!formCode.trim()) { setFormError('Code is required.'); return }
    if (!formType) { setFormError('Fund type is required.'); return }
    const navNum = Number(formNav)
    if (!formNav || isNaN(navNum) || navNum < 0.01) {
      setFormError('NAV must be greater than 0.')
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
          setFormError('This fund code already exists. Please use a different code.')
        } else {
          setFormError(data.error || 'Something went wrong. Please try again later.')
        }
        return
      }
      closeModal()
      await loadFunds()
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
      await loadFunds()
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
      await loadFunds()
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
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Fund Library</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Manage your investment funds</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleRefreshNav}
              disabled={refreshing || !funds.some(f => f.nav_source_url)}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {refreshing ? 'Refreshing…' : '↻ Refresh NAV'}
            </button>
            <button
              onClick={openAddModal}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded transition-colors"
            >
              Add Fund
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
              onClick={loadFunds}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded hover:bg-indigo-700 transition-colors"
            >
              Retry
            </button>
          </div>
        ) : funds.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow p-16 text-center border border-gray-100 dark:border-gray-700">
            <div className="text-5xl mb-4">📚</div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">No funds yet</h2>
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
              Add your first fund to get started. You&apos;ll be able to select these funds when setting up your allocation.
            </p>
            <button
              onClick={openAddModal}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded hover:bg-indigo-700 transition-colors"
            >
              Add Fund
            </button>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block bg-white dark:bg-gray-900 rounded-lg shadow overflow-x-auto border border-gray-100 dark:border-gray-700">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left"><SortButton col="name" label="Name" /></th>
                    <th className="px-4 py-3 text-left"><SortButton col="code" label="Code" /></th>
                    <th className="px-4 py-3 text-left"><SortButton col="fund_type" label="Type" /></th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600 dark:text-gray-400">NAV</th>
                    <th className="px-4 py-3 text-right text-sm font-semibold text-gray-600 dark:text-gray-400">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedFunds.map((fund) => (
                    <tr key={fund.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">{fund.name}</td>
                      <td className="px-4 py-3 text-sm font-mono text-gray-500 dark:text-gray-400">{fund.code}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-1 rounded font-medium ${FUND_TYPE_COLORS[fund.fund_type]}`}>
                          {FUND_TYPE_LABELS[fund.fund_type]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">
                        <span>{fund.nav.toLocaleString()}</span>
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
                            Edit
                          </button>
                          <button
                            onClick={() => setDeleteTarget(fund)}
                            className="text-xs px-3 py-1 border border-red-200 dark:border-red-800 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 transition-colors"
                          >
                            Delete
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
                      <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{fund.name}</p>
                      <p className="text-xs font-mono text-gray-500 dark:text-gray-400">{fund.code}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded font-medium ${FUND_TYPE_COLORS[fund.fund_type]}`}>
                      {FUND_TYPE_LABELS[fund.fund_type]}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
                    NAV: <span className="font-medium">{fund.nav.toLocaleString()}</span>
                    {fund.nav_source_url && fund.updated_at && (
                      <span className="text-xs text-gray-400 ml-1">{formatRelativeDate(fund.updated_at)}</span>
                    )}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => openEditModal(fund)}
                      className="flex-1 text-xs px-3 py-2 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeleteTarget(fund)}
                      className="flex-1 text-xs px-3 py-2 border border-red-200 dark:border-red-800 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 transition-colors"
                    >
                      Delete
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
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-md p-6 border border-gray-100 dark:border-gray-700">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">
              {modalMode === 'add' ? 'Add Fund' : 'Edit Fund'}
            </h2>
            {formError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-sm rounded border border-red-200 dark:border-red-800">{formError}</div>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fund Name *</label>
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Code *</label>
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
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type *</label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value as FundType)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                  >
                    <option value="">Select type</option>
                    {(Object.keys(FUND_TYPE_LABELS) as FundType[]).map((t) => (
                      <option key={t} value={t}>{FUND_TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">NAV *</label>
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
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">NAV Source URL <span className="text-gray-400 font-normal">(optional)</span></label>
                <input
                  type="url"
                  value={formNavUrl}
                  onChange={(e) => setFormNavUrl(e.target.value)}
                  placeholder="e.g., https://www.vcbf.com/quy-trai-phieu"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={closeModal}
                disabled={saving}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Fund'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 z-40 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-sm p-6 border border-gray-100 dark:border-gray-700">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">Delete {deleteTarget.name}?</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">This action cannot be undone.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded transition-colors disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
