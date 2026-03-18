'use client'

import { useState, useEffect, useCallback } from 'react'

interface Goal {
  goal_id: string
  goal_name: string
  description: string | null
}

interface Fund {
  id: string
  name: string
  code: string
}

interface Transaction {
  transaction_id: string
  asset_type: string
  investment_date: string
  amount_vnd: number
  unit_price: number | null
  units: number | null
  interest_rate: number | null
  notes: string | null
  fund_id: string | null
  fund_display?: string
}

const ASSET_TYPES = ['fund', 'bank', 'stock', 'gold'] as const
type AssetType = typeof ASSET_TYPES[number]

const ASSET_COLORS: Record<AssetType, string> = {
  fund: 'bg-purple-100 text-purple-700',
  bank: 'bg-blue-100 text-blue-700',
  stock: 'bg-green-100 text-green-700',
  gold: 'bg-amber-100 text-amber-700',
}

function calcProjectedInterest(amount: number, rate: number | null, investmentDate: string): number {
  if (!rate) return 0
  const months = Math.max(0, Math.floor(
    (Date.now() - new Date(investmentDate).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
  ))
  return amount * Math.pow(1 + rate / 100 / 12, months) - amount
}

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')

const emptyForm = { asset_type: 'bank', investment_date: '', amount_vnd: '', unit_price: '', units: '', interest_rate: '', notes: '', fund_id: '' }

export default function GoalDetailView({ goal, onBack }: { goal: Goal; onBack: () => void }) {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [funds, setFunds] = useState<Fund[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editTx, setEditTx] = useState<Transaction | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/v1/investment-transactions?goal_id=${goal.goal_id}&limit=1000`)
    const { transactions: txs } = await res.json()

    // Attach fund display strings
    const fundsRes = await fetch('/api/funds')
    const { funds: allFunds } = await fundsRes.json()
    const fundMap: Record<string, Fund> = {}
    for (const f of (allFunds ?? [])) fundMap[f.id] = f

    const enriched = (txs ?? []).map((tx: Transaction) => ({
      ...tx,
      fund_display: tx.fund_id && fundMap[tx.fund_id] ? `${fundMap[tx.fund_id].code} - ${fundMap[tx.fund_id].name}` : undefined,
    }))

    setFunds(allFunds ?? [])
    setTransactions(enriched)
    setLoading(false)
  }, [goal.goal_id])

  useEffect(() => { fetchTransactions() }, [fetchTransactions])

  function openAdd() {
    setEditTx(null)
    setForm({ ...emptyForm, investment_date: new Date().toISOString().slice(0, 10) })
    setFormError('')
    setShowForm(true)
  }

  function openEdit(tx: Transaction) {
    setEditTx(tx)
    setForm({
      asset_type: tx.asset_type,
      investment_date: tx.investment_date,
      amount_vnd: String(tx.amount_vnd),
      unit_price: tx.unit_price != null ? String(tx.unit_price) : '',
      units: tx.units != null ? String(tx.units) : '',
      interest_rate: tx.interest_rate != null ? String(tx.interest_rate) : '',
      notes: tx.notes ?? '',
      fund_id: tx.fund_id ?? '',
    })
    setFormError('')
    setShowForm(true)
  }

  function handleAssetTypeChange(value: string) {
    setForm({ ...form, asset_type: value, fund_id: '' })
  }

  async function handleSave() {
    setFormError('')
    if (form.asset_type === 'fund' && !form.fund_id) {
      setFormError('Please select a fund.')
      return
    }
    const payload = {
      goal_id: goal.goal_id,
      asset_type: form.asset_type,
      investment_date: form.investment_date,
      amount_vnd: Number(form.amount_vnd),
      unit_price: form.unit_price ? Number(form.unit_price) : null,
      units: form.units ? Number(form.units) : null,
      interest_rate: form.interest_rate ? Number(form.interest_rate) : null,
      notes: form.notes || null,
      fund_id: form.asset_type === 'fund' ? form.fund_id : null,
    }
    setSaving(true)
    const url = editTx ? `/api/v1/investment-transactions/${editTx.transaction_id}` : '/api/v1/investment-transactions'
    const res = await fetch(url, {
      method: editTx ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const { error } = await res.json()
      setFormError(error ?? 'Something went wrong.')
    } else {
      setShowForm(false)
      await fetchTransactions()
    }
    setSaving(false)
  }

  async function handleDelete(tx: Transaction) {
    if (!confirm('Delete this transaction?')) return
    const res = await fetch(`/api/v1/investment-transactions/${tx.transaction_id}`, { method: 'DELETE' })
    if (res.ok) {
      setSuccessMsg('Transaction deleted.')
      setTimeout(() => setSuccessMsg(''), 4000)
      await fetchTransactions()
    }
  }

  const totalInvested = transactions.reduce((s, tx) => s + tx.amount_vnd, 0)
  const totalInterest = transactions.reduce((s, tx) => s + calcProjectedInterest(tx.amount_vnd, tx.interest_rate, tx.investment_date), 0)

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">← Back</button>
        <div>
          <h2 className="text-xl font-bold text-gray-900">{goal.goal_name}</h2>
          {goal.description && <p className="text-sm text-gray-500">{goal.description}</p>}
        </div>
      </div>

      {successMsg && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-800 rounded-lg text-sm">{successMsg}</div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Current Value', value: fmt(totalInvested + totalInterest) },
          { label: 'Invested Amount', value: fmt(totalInvested) },
          { label: 'Projected Interest', value: fmt(totalInterest) },
        ].map((item) => (
          <div key={item.label} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 text-center">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">{item.label}</p>
            <p className="text-xl font-bold text-indigo-700">{item.value}</p>
          </div>
        ))}
      </div>

      {/* Transactions table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Investment Transactions</h3>
          <button onClick={openAdd} className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700">
            Add Transaction
          </button>
        </div>

        {loading ? (
          <div className="text-center py-10 text-gray-400 text-sm">Loading...</div>
        ) : transactions.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <p className="mb-2">No transactions yet.</p>
            <p className="text-sm">Add a transaction to start tracking.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['Date', 'Asset Type', 'Fund', 'Amount', 'Units', 'Interest Rate', 'Projected Interest', 'Notes', 'Actions'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {transactions.map((tx) => {
                  const interest = calcProjectedInterest(tx.amount_vnd, tx.interest_rate, tx.investment_date)
                  return (
                    <tr key={tx.transaction_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-700">{new Date(tx.investment_date).toLocaleDateString('vi-VN')}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ASSET_COLORS[tx.asset_type as AssetType] ?? 'bg-gray-100 text-gray-700'}`}>
                          {tx.asset_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{tx.fund_display ?? '—'}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{fmt(tx.amount_vnd)}</td>
                      <td className="px-4 py-3 text-gray-500">{tx.units != null ? tx.units : '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{tx.interest_rate != null ? `${tx.interest_rate}%` : '—'}</td>
                      <td className="px-4 py-3 text-indigo-600 font-medium">{fmt(interest)}</td>
                      <td className="px-4 py-3 text-gray-400 max-w-32 truncate">{tx.notes ?? '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button onClick={() => openEdit(tx)} className="text-xs text-indigo-600 hover:underline">Edit</button>
                          <button onClick={() => handleDelete(tx)} className="text-xs text-red-500 hover:underline">Delete</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit Transaction Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{editTx ? 'Edit Transaction' : 'Add Transaction'}</h3>
            {formError && <p className="text-red-600 text-sm mb-3">{formError}</p>}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Asset Type *</label>
                  <select
                    value={form.asset_type}
                    onChange={(e) => handleAssetTypeChange(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {ASSET_TYPES.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Investment Date *</label>
                  <input
                    type="date"
                    value={form.investment_date}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setForm({ ...form, investment_date: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
              {form.asset_type === 'fund' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fund *</label>
                  <select
                    value={form.fund_id}
                    onChange={(e) => setForm({ ...form, fund_id: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Select a fund...</option>
                    {funds.map((f) => (
                      <option key={f.id} value={f.id}>{f.code} - {f.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (VND) *</label>
                <input
                  type="number"
                  value={form.amount_vnd}
                  onChange={(e) => setForm({ ...form, amount_vnd: e.target.value })}
                  placeholder="e.g. 10000000"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unit Price</label>
                  <input
                    type="number"
                    value={form.unit_price}
                    onChange={(e) => setForm({ ...form, unit_price: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Units</label>
                  <input
                    type="number"
                    value={form.units}
                    onChange={(e) => setForm({ ...form, units: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Interest Rate (%/year)</label>
                <input
                  type="number"
                  step="0.1"
                  value={form.interest_rate}
                  onChange={(e) => setForm({ ...form, interest_rate: e.target.value })}
                  placeholder="e.g. 5.5"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
