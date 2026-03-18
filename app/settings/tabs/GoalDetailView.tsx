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
  nav: number
}

// Rows from investment_transactions (bank/stock/gold + legacy fund entries)
interface TxRow {
  _source: 'tx'
  _id: string
  asset_type: string
  investment_date: string
  amount_vnd: number
  unit_price: number | null
  units: number | null
  interest_rate: number | null
  notes: string | null
  fund_id: string | null
  fund_display?: string
  current_value: number
}

// Rows from fund_investments (synced with Monthly Planning)
interface FiRow {
  _source: 'fi'
  _id: string
  fund_id: string
  fund_name: string
  current_nav: number
  amount_vnd: number
  units_purchased: number
  nav_at_purchase: number
  created_at: string
  current_value: number
}

type Row = TxRow | FiRow

const ASSET_COLORS: Record<string, string> = {
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

const emptyTxForm = { asset_type: 'bank', investment_date: '', amount_vnd: '', unit_price: '', units: '', interest_rate: '', notes: '', fund_id: '' }
const emptyFiForm = { fund_id: '', amount_vnd: '', units_purchased: '', nav_at_purchase: '' }

export default function GoalDetailView({ goal, onBack }: { goal: Goal; onBack: () => void }) {
  const [rows, setRows] = useState<Row[]>([])
  const [funds, setFunds] = useState<Fund[]>([])
  const [loading, setLoading] = useState(true)
  const [successMsg, setSuccessMsg] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  // Form mode: null = closed, 'tx-add', 'tx-edit', 'fi-add', 'fi-edit'
  const [formMode, setFormMode] = useState<'tx-add' | 'tx-edit' | 'fi-add' | 'fi-edit' | null>(null)
  const [editTx, setEditTx] = useState<TxRow | null>(null)
  const [editFi, setEditFi] = useState<FiRow | null>(null)
  const [txForm, setTxForm] = useState(emptyTxForm)
  const [fiForm, setFiForm] = useState(emptyFiForm)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [txRes, fiRes, fundsRes] = await Promise.all([
      fetch(`/api/v1/investment-transactions?goal_id=${goal.goal_id}&limit=1000`),
      fetch(`/api/v1/fund-investments?goal_id=${goal.goal_id}`),
      fetch('/api/funds'),
    ])

    const { transactions: txs } = txRes.ok ? await txRes.json() : { transactions: [] }
    const fiData: Array<{ id: string; fund_id: string; amount_vnd: number; units_purchased: number; nav_at_purchase: number; created_at: string; funds: { id: string; name: string; nav: number } | null }> =
      fiRes.ok ? await fiRes.json() : []
    const { funds: allFunds } = fundsRes.ok ? await fundsRes.json() : { funds: [] }

    const fundMap: Record<string, Fund> = {}
    for (const f of (allFunds ?? [])) fundMap[f.id] = f
    setFunds(allFunds ?? [])

    const txRows: TxRow[] = (txs ?? []).map((tx: { transaction_id: string; asset_type: string; investment_date: string; amount_vnd: number; unit_price: number | null; units: number | null; interest_rate: number | null; notes: string | null; fund_id: string | null }) => {
      const interest = calcProjectedInterest(tx.amount_vnd, tx.interest_rate, tx.investment_date)
      return {
        _source: 'tx' as const,
        _id: tx.transaction_id,
        asset_type: tx.asset_type,
        investment_date: tx.investment_date,
        amount_vnd: tx.amount_vnd,
        unit_price: tx.unit_price,
        units: tx.units,
        interest_rate: tx.interest_rate,
        notes: tx.notes,
        fund_id: tx.fund_id,
        fund_display: tx.fund_id && fundMap[tx.fund_id] ? `${fundMap[tx.fund_id].code} - ${fundMap[tx.fund_id].name}` : undefined,
        current_value: tx.amount_vnd + interest,
      }
    })

    const fiRows: FiRow[] = fiData.map((fi) => {
      const currentNav = fi.funds?.nav ?? fi.nav_at_purchase
      return {
        _source: 'fi' as const,
        _id: fi.id,
        fund_id: fi.fund_id,
        fund_name: fi.funds?.name ?? fundMap[fi.fund_id]?.name ?? fi.fund_id,
        current_nav: currentNav,
        amount_vnd: fi.amount_vnd,
        units_purchased: fi.units_purchased,
        nav_at_purchase: fi.nav_at_purchase,
        created_at: fi.created_at,
        current_value: fi.units_purchased * currentNav,
      }
    })

    // Merge: fi rows first (most recent Monthly Planning investments), then tx rows
    setRows([...fiRows, ...txRows])
    setLoading(false)
  }, [goal.goal_id])

  useEffect(() => { fetchData() }, [fetchData])

  // --- TX handlers ---
  function openTxAdd() {
    setTxForm({ ...emptyTxForm, investment_date: new Date().toISOString().slice(0, 10) })
    setEditTx(null)
    setFormError('')
    setFormMode('tx-add')
  }

  function openTxEdit(row: TxRow) {
    setTxForm({
      asset_type: row.asset_type,
      investment_date: row.investment_date,
      amount_vnd: String(row.amount_vnd),
      unit_price: row.unit_price != null ? String(row.unit_price) : '',
      units: row.units != null ? String(row.units) : '',
      interest_rate: row.interest_rate != null ? String(row.interest_rate) : '',
      notes: row.notes ?? '',
      fund_id: row.fund_id ?? '',
    })
    setEditTx(row)
    setFormError('')
    setFormMode('tx-edit')
  }

  async function handleTxSave() {
    setFormError('')
    if (!txForm.amount_vnd || Number(txForm.amount_vnd) <= 0) { setFormError('Amount must be greater than 0.'); return }
    if (!txForm.investment_date) { setFormError('Investment date is required.'); return }
    const payload = {
      goal_id: goal.goal_id,
      asset_type: txForm.asset_type,
      investment_date: txForm.investment_date,
      amount_vnd: Number(txForm.amount_vnd),
      unit_price: txForm.unit_price ? Number(txForm.unit_price) : null,
      units: txForm.units ? Number(txForm.units) : null,
      interest_rate: txForm.interest_rate ? Number(txForm.interest_rate) : null,
      notes: txForm.notes || null,
      fund_id: txForm.asset_type === 'fund' ? (txForm.fund_id || null) : null,
    }
    setSaving(true)
    const url = editTx ? `/api/v1/investment-transactions/${editTx._id}` : '/api/v1/investment-transactions'
    const res = await fetch(url, { method: editTx ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (!res.ok) { const { error } = await res.json(); setFormError(error ?? 'Something went wrong.') }
    else { setFormMode(null); await fetchData() }
    setSaving(false)
  }

  async function handleTxDelete(row: TxRow) {
    if (!confirm('Delete this transaction?')) return
    const res = await fetch(`/api/v1/investment-transactions/${row._id}`, { method: 'DELETE' })
    if (res.ok) { setSuccessMsg('Transaction deleted.'); setTimeout(() => setSuccessMsg(''), 4000); await fetchData() }
  }

  // --- FI handlers ---
  function openFiAdd() {
    setFiForm(emptyFiForm)
    setEditFi(null)
    setFormError('')
    setFormMode('fi-add')
  }

  function openFiEdit(row: FiRow) {
    setFiForm({
      fund_id: row.fund_id,
      amount_vnd: String(row.amount_vnd),
      units_purchased: String(row.units_purchased),
      nav_at_purchase: String(row.nav_at_purchase),
    })
    setEditFi(row)
    setFormError('')
    setFormMode('fi-edit')
  }

  async function handleFiSave() {
    setFormError('')
    if (!fiForm.fund_id) { setFormError('Please select a fund.'); return }
    if (!fiForm.amount_vnd || Number(fiForm.amount_vnd) <= 0) { setFormError('Amount must be greater than 0.'); return }
    if (!fiForm.units_purchased || Number(fiForm.units_purchased) <= 0) { setFormError('Units must be greater than 0.'); return }
    if (!fiForm.nav_at_purchase || Number(fiForm.nav_at_purchase) <= 0) { setFormError('NAV at purchase must be positive.'); return }

    const payload = {
      fund_id: fiForm.fund_id,
      goal_id: goal.goal_id,
      amount_vnd: Number(fiForm.amount_vnd),
      units_purchased: Number(fiForm.units_purchased),
      nav_at_purchase: Number(fiForm.nav_at_purchase),
    }
    setSaving(true)
    const url = editFi ? `/api/v1/fund-investments/${editFi._id}` : '/api/v1/fund-investments'
    const res = await fetch(url, { method: editFi ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (!res.ok) { const { error } = await res.json(); setFormError(error ?? 'Something went wrong.') }
    else { setFormMode(null); await fetchData() }
    setSaving(false)
  }

  async function handleFiDelete(row: FiRow) {
    if (!confirm('Delete this fund investment?')) return
    const res = await fetch(`/api/v1/fund-investments/${row._id}`, { method: 'DELETE' })
    if (res.status === 204 || res.ok) {
      setSuccessMsg('Investment deleted.')
      setTimeout(() => setSuccessMsg(''), 4000)
      await fetchData()
    }
  }

  // Summary totals
  const totalInvested = rows.reduce((s, r) => s + r.amount_vnd, 0)
  const totalCurrentValue = rows.reduce((s, r) => s + r.current_value, 0)
  const totalGain = totalCurrentValue - totalInvested

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
          { label: 'Total Current Value', value: fmt(totalCurrentValue) },
          { label: 'Total Invested', value: fmt(totalInvested) },
          { label: 'Total Gain / Loss', value: fmt(totalGain) },
        ].map((item) => (
          <div key={item.label} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 text-center">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">{item.label}</p>
            <p className={`text-xl font-bold ${item.label === 'Total Gain / Loss' ? (totalGain >= 0 ? 'text-green-600' : 'text-red-600') : 'text-indigo-700'}`}>
              {item.value}
            </p>
          </div>
        ))}
      </div>

      {/* Fund Investments (synced with Monthly Planning) */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-900">Fund Investments</h3>
            <p className="text-xs text-gray-400 mt-0.5">Synced with Monthly Planning</p>
          </div>
          <button onClick={openFiAdd} className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700">
            Add Fund Investment
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-400 text-sm">Loading...</div>
        ) : rows.filter(r => r._source === 'fi').length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">No fund investments yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['Date', 'Fund', 'Amount', 'Units', 'NAV at Purchase', 'Current NAV', 'Current Value', 'P&L', 'Actions'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.filter((r): r is FiRow => r._source === 'fi').map((row) => {
                  const pl = row.current_value - row.amount_vnd
                  return (
                    <tr key={row._id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-700">{new Date(row.created_at).toLocaleDateString('vi-VN')}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{row.fund_name}</td>
                      <td className="px-4 py-3 text-gray-700">{fmt(row.amount_vnd)}</td>
                      <td className="px-4 py-3 text-gray-500">{row.units_purchased}</td>
                      <td className="px-4 py-3 text-gray-500">{fmt(row.nav_at_purchase)}</td>
                      <td className="px-4 py-3 text-gray-500">{fmt(row.current_nav)}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{fmt(row.current_value)}</td>
                      <td className={`px-4 py-3 font-medium ${pl >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(pl)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button onClick={() => openFiEdit(row)} className="text-xs text-indigo-600 hover:underline">Edit</button>
                          <button onClick={() => handleFiDelete(row)} className="text-xs text-red-500 hover:underline">Delete</button>
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

      {/* Other Transactions (bank/stock/gold) */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-900">Other Transactions</h3>
            <p className="text-xs text-gray-400 mt-0.5">Bank deposits, stocks, gold</p>
          </div>
          <button onClick={openTxAdd} className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700">
            Add Transaction
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-400 text-sm">Loading...</div>
        ) : rows.filter(r => r._source === 'tx').length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">No transactions yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['Date', 'Type', 'Fund', 'Amount', 'Units', 'Interest Rate', 'Gain/Loss', 'Notes', 'Actions'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.filter((r): r is TxRow => r._source === 'tx').map((row) => {
                  const gain = row.current_value - row.amount_vnd
                  return (
                    <tr key={row._id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-700">{new Date(row.investment_date).toLocaleDateString('vi-VN')}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ASSET_COLORS[row.asset_type] ?? 'bg-gray-100 text-gray-700'}`}>
                          {row.asset_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{row.fund_display ?? '—'}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{fmt(row.amount_vnd)}</td>
                      <td className="px-4 py-3 text-gray-500">{row.units ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{row.interest_rate != null ? `${row.interest_rate}%` : '—'}</td>
                      <td className={`px-4 py-3 font-medium ${gain >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(gain)}</td>
                      <td className="px-4 py-3 text-gray-400 max-w-32 truncate">{row.notes ?? '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button onClick={() => openTxEdit(row)} className="text-xs text-indigo-600 hover:underline">Edit</button>
                          <button onClick={() => handleTxDelete(row)} className="text-xs text-red-500 hover:underline">Delete</button>
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

      {/* Fund Investment Add/Edit Modal */}
      {(formMode === 'fi-add' || formMode === 'fi-edit') && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{formMode === 'fi-edit' ? 'Edit Fund Investment' : 'Add Fund Investment'}</h3>
            {formError && <p className="text-red-600 text-sm mb-3">{formError}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fund *</label>
                <select
                  value={fiForm.fund_id}
                  onChange={(e) => setFiForm({ ...fiForm, fund_id: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Select a fund...</option>
                  {funds.map((f) => <option key={f.id} value={f.id}>{f.code} - {f.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (VND) *</label>
                <input type="number" value={fiForm.amount_vnd} onChange={(e) => setFiForm({ ...fiForm, amount_vnd: e.target.value })}
                  placeholder="e.g. 10000000" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Units *</label>
                  <input type="number" value={fiForm.units_purchased} onChange={(e) => setFiForm({ ...fiForm, units_purchased: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">NAV at Purchase *</label>
                  <input type="number" value={fiForm.nav_at_purchase} onChange={(e) => setFiForm({ ...fiForm, nav_at_purchase: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setFormMode(null)} className="flex-1 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleFiSave} disabled={saving} className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Other Transaction Add/Edit Modal */}
      {(formMode === 'tx-add' || formMode === 'tx-edit') && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{formMode === 'tx-edit' ? 'Edit Transaction' : 'Add Transaction'}</h3>
            {formError && <p className="text-red-600 text-sm mb-3">{formError}</p>}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Asset Type *</label>
                  <select value={txForm.asset_type} onChange={(e) => setTxForm({ ...txForm, asset_type: e.target.value, fund_id: '' })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    {['bank', 'stock', 'gold'].map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Investment Date *</label>
                  <input type="date" value={txForm.investment_date} max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setTxForm({ ...txForm, investment_date: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (VND) *</label>
                <input type="number" value={txForm.amount_vnd} onChange={(e) => setTxForm({ ...txForm, amount_vnd: e.target.value })}
                  placeholder="e.g. 10000000" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unit Price</label>
                  <input type="number" value={txForm.unit_price} onChange={(e) => setTxForm({ ...txForm, unit_price: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Units</label>
                  <input type="number" value={txForm.units} onChange={(e) => setTxForm({ ...txForm, units: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Interest Rate (%/year)</label>
                <input type="number" step="0.1" value={txForm.interest_rate} onChange={(e) => setTxForm({ ...txForm, interest_rate: e.target.value })}
                  placeholder="e.g. 5.5" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea value={txForm.notes} onChange={(e) => setTxForm({ ...txForm, notes: e.target.value })} rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setFormMode(null)} className="flex-1 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleTxSave} disabled={saving} className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
