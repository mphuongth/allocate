'use client'

import { useState, useEffect, useCallback } from 'react'

interface Goal {
  goal_id: string
  goal_name: string
  description: string | null
  target_amount: number | null
}

interface Fund {
  id: string
  name: string
  code: string
  nav: number
}

interface TxRow {
  _source: 'fund' | 'other'
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
  current_value: number
}

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
const emptyFiForm = { fund_id: '', amount_vnd: '', units: '', unit_price: '' }

export default function GoalDetailView({ goal, onBack }: { goal: Goal; onBack: () => void }) {
  const [rows, setRows] = useState<TxRow[]>([])
  const [funds, setFunds] = useState<Fund[]>([])
  const [loading, setLoading] = useState(true)
  const [successMsg, setSuccessMsg] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  // Form mode: null = closed, 'tx-add', 'tx-edit', 'fi-add', 'fi-edit'
  const [formMode, setFormMode] = useState<'tx-add' | 'tx-edit' | 'fi-add' | 'fi-edit' | null>(null)
  const [editTx, setEditTx] = useState<TxRow | null>(null)
  const [txForm, setTxForm] = useState(emptyTxForm)
  const [fiForm, setFiForm] = useState(emptyFiForm)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [txRes, fundsRes] = await Promise.all([
      fetch(`/api/v1/investment-transactions?goal_id=${goal.goal_id}&limit=1000`),
      fetch('/api/funds'),
    ])

    const { transactions: txs } = txRes.ok ? await txRes.json() : { transactions: [] }
    const { funds: allFunds } = fundsRes.ok ? await fundsRes.json() : { funds: [] }

    const fundMap: Record<string, Fund> = {}
    for (const f of (allFunds ?? [])) fundMap[f.id] = f
    setFunds(allFunds ?? [])

    const txRows: TxRow[] = (txs ?? []).map((tx: {
      transaction_id: string; asset_type: string; investment_date: string; amount_vnd: number
      unit_price: number | null; units: number | null; interest_rate: number | null; notes: string | null
      fund_id: string | null; funds?: { id: string; name: string; nav: number } | null
    }) => {
      let currentValue: number
      if (tx.asset_type === 'fund' && tx.units) {
        const fund = Array.isArray(tx.funds) ? tx.funds[0] : tx.funds
        const currentNav = fund?.nav ?? tx.unit_price ?? 0
        currentValue = tx.units * currentNav
      } else {
        const interest = calcProjectedInterest(tx.amount_vnd, tx.interest_rate, tx.investment_date)
        currentValue = tx.amount_vnd + interest
      }
      return {
        _source: tx.asset_type === 'fund' ? 'fund' : 'other',
        transaction_id: tx.transaction_id,
        asset_type: tx.asset_type,
        investment_date: tx.investment_date,
        amount_vnd: tx.amount_vnd,
        unit_price: tx.unit_price,
        units: tx.units,
        interest_rate: tx.interest_rate,
        notes: tx.notes,
        fund_id: tx.fund_id,
        fund_display: tx.fund_id && fundMap[tx.fund_id] ? `${fundMap[tx.fund_id].code} - ${fundMap[tx.fund_id].name}` : undefined,
        current_value: currentValue,
      }
    })

    setRows(txRows)
    setLoading(false)
  }, [goal.goal_id])

  useEffect(() => { fetchData() }, [fetchData])

  // --- Other tx handlers ---
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
    const url = editTx ? `/api/v1/investment-transactions/${editTx.transaction_id}` : '/api/v1/investment-transactions'
    const res = await fetch(url, { method: editTx ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (!res.ok) { const { error } = await res.json(); setFormError(error ?? 'Something went wrong.') }
    else { setFormMode(null); await fetchData() }
    setSaving(false)
  }

  async function handleTxDelete(row: TxRow) {
    if (!confirm('Delete this transaction?')) return
    const res = await fetch(`/api/v1/investment-transactions/${row.transaction_id}`, { method: 'DELETE' })
    if (res.ok) { setSuccessMsg('Transaction deleted.'); setTimeout(() => setSuccessMsg(''), 4000); await fetchData() }
  }

  // --- Fund investment handlers ---
  function openFiAdd() {
    setFiForm(emptyFiForm)
    setEditTx(null)
    setFormError('')
    setFormMode('fi-add')
  }

  function openFiEdit(row: TxRow) {
    setFiForm({
      fund_id: row.fund_id ?? '',
      amount_vnd: String(row.amount_vnd),
      units: row.units != null ? String(row.units) : '',
      unit_price: row.unit_price != null ? String(row.unit_price) : '',
    })
    setEditTx(row)
    setFormError('')
    setFormMode('fi-edit')
  }

  async function handleFiSave() {
    setFormError('')
    if (!fiForm.fund_id) { setFormError('Please select a fund.'); return }
    if (!fiForm.amount_vnd || Number(fiForm.amount_vnd) <= 0) { setFormError('Amount must be greater than 0.'); return }
    if (!fiForm.units || Number(fiForm.units) <= 0) { setFormError('Units must be greater than 0.'); return }
    if (!fiForm.unit_price || Number(fiForm.unit_price) <= 0) { setFormError('NAV at purchase must be positive.'); return }

    const payload = {
      asset_type: 'fund',
      fund_id: fiForm.fund_id,
      goal_id: goal.goal_id,
      amount_vnd: Number(fiForm.amount_vnd),
      units: Number(fiForm.units),
      unit_price: Number(fiForm.unit_price),
      investment_date: editTx?.investment_date ?? new Date().toISOString().slice(0, 10),
    }
    setSaving(true)
    const url = editTx ? `/api/v1/investment-transactions/${editTx.transaction_id}` : '/api/v1/investment-transactions'
    const res = await fetch(url, { method: editTx ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (!res.ok) { const { error } = await res.json(); setFormError(error ?? 'Something went wrong.') }
    else { setFormMode(null); await fetchData() }
    setSaving(false)
  }

  async function handleFiDelete(row: TxRow) {
    if (!confirm('Delete this fund investment?')) return
    const res = await fetch(`/api/v1/investment-transactions/${row.transaction_id}`, { method: 'DELETE' })
    if (res.ok) {
      setSuccessMsg('Investment deleted.')
      setTimeout(() => setSuccessMsg(''), 4000)
      await fetchData()
    }
  }

  const fundRows = rows.filter((r) => r._source === 'fund')
  const otherRows = rows.filter((r) => r._source === 'other')

  const totalInvested = rows.reduce((s, r) => s + r.amount_vnd, 0)
  const totalCurrentValue = rows.reduce((s, r) => s + r.current_value, 0)
  const totalGain = totalCurrentValue - totalInvested

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium">← Back</button>
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{goal.goal_name}</h2>
          {goal.description && <p className="text-sm text-gray-500 dark:text-gray-400">{goal.description}</p>}
        </div>
      </div>

      {successMsg && (
        <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-300 rounded-lg text-sm">{successMsg}</div>
      )}

      {/* Goal Progress */}
      {goal.target_amount != null && (
        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 mb-6">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-medium text-gray-700 dark:text-gray-300">Goal Progress</span>
            <span className="text-gray-500 dark:text-gray-400">
              {fmt(totalCurrentValue)} / {fmt(goal.target_amount)}
            </span>
          </div>
          {(() => {
            const pct = Math.min((totalCurrentValue / goal.target_amount!) * 100, 100)
            const exceeded = totalCurrentValue >= goal.target_amount!
            return (
              <>
                <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${exceeded ? 'bg-green-500' : 'bg-indigo-500'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex items-center justify-between mt-1.5 text-xs text-gray-400 dark:text-gray-500">
                  <span>{Math.round(pct)}%</span>
                  {exceeded
                    ? <span className="text-green-600 dark:text-green-400 font-medium">Target reached!</span>
                    : <span>{fmt(goal.target_amount! - totalCurrentValue)} remaining</span>
                  }
                </div>
              </>
            )
          })()}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Current Value', value: fmt(totalCurrentValue) },
          { label: 'Total Invested', value: fmt(totalInvested) },
          { label: 'Total Gain / Loss', value: fmt(totalGain) },
        ].map((item) => (
          <div key={item.label} className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 text-center">
            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide mb-1">{item.label}</p>
            <p className={`text-xl font-bold ${item.label === 'Total Gain / Loss' ? (totalGain >= 0 ? 'text-green-600' : 'text-red-600') : 'text-indigo-700 dark:text-indigo-300'}`}>
              {item.value}
            </p>
          </div>
        ))}
      </div>

      {/* Fund Investments */}
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden mb-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">Fund Investments</h3>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">From Settings and Monthly Planning</p>
          </div>
          <button onClick={openFiAdd} className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700">
            Add Fund Investment
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">Loading...</div>
        ) : fundRows.length === 0 ? (
          <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">No fund investments yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  {['Date', 'Fund', 'Amount', 'Units', 'NAV at Purchase', 'Current NAV', 'Current Value', 'P&L', 'Actions'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                {fundRows.map((row) => {
                  const pl = row.current_value - row.amount_vnd
                  const fund = funds.find((f) => f.id === row.fund_id)
                  const currentNav = fund?.nav ?? row.unit_price ?? 0
                  return (
                    <tr key={row.transaction_id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{new Date(row.investment_date).toLocaleDateString('vi-VN')}</td>
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{row.fund_display ?? row.fund_id ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{fmt(row.amount_vnd)}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{row.units ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{row.unit_price != null ? fmt(row.unit_price) : '—'}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{fmt(currentNav)}</td>
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{fmt(row.current_value)}</td>
                      <td className={`px-4 py-3 font-medium ${pl >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(pl)}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button onClick={() => openFiEdit(row)} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Edit</button>
                          <button onClick={() => handleFiDelete(row)} className="text-xs text-red-500 dark:text-red-400 hover:underline">Delete</button>
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
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">Other Transactions</h3>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Bank deposits, stocks, gold</p>
          </div>
          <button onClick={openTxAdd} className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700">
            Add Transaction
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">Loading...</div>
        ) : otherRows.length === 0 ? (
          <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">No transactions yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  {['Date', 'Type', 'Amount', 'Units', 'Interest Rate', 'Gain/Loss', 'Notes', 'Actions'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                {otherRows.map((row) => {
                  const gain = row.current_value - row.amount_vnd
                  return (
                    <tr key={row.transaction_id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{new Date(row.investment_date).toLocaleDateString('vi-VN')}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ASSET_COLORS[row.asset_type] ?? 'bg-gray-100 text-gray-700'}`}>
                          {row.asset_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{fmt(row.amount_vnd)}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{row.units ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{row.interest_rate != null ? `${row.interest_rate}%` : '—'}</td>
                      <td className={`px-4 py-3 font-medium ${gain >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(gain)}</td>
                      <td className="px-4 py-3 text-gray-400 dark:text-gray-500 max-w-32 truncate">{row.notes ?? '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button onClick={() => openTxEdit(row)} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Edit</button>
                          <button onClick={() => handleTxDelete(row)} className="text-xs text-red-500 dark:text-red-400 hover:underline">Delete</button>
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
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-6 border border-gray-100 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{formMode === 'fi-edit' ? 'Edit Fund Investment' : 'Add Fund Investment'}</h3>
            {formError && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{formError}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fund *</label>
                <select
                  value={fiForm.fund_id}
                  onChange={(e) => setFiForm({ ...fiForm, fund_id: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Select a fund...</option>
                  {funds.map((f) => <option key={f.id} value={f.id}>{f.code} - {f.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount (VND) *</label>
                <input type="number" value={fiForm.amount_vnd} onChange={(e) => setFiForm({ ...fiForm, amount_vnd: e.target.value })}
                  placeholder="e.g. 10000000" className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Units *</label>
                  <input type="number" value={fiForm.units} onChange={(e) => setFiForm({ ...fiForm, units: e.target.value })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">NAV at Purchase *</label>
                  <input type="number" value={fiForm.unit_price} onChange={(e) => setFiForm({ ...fiForm, unit_price: e.target.value })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setFormMode(null)} className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
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
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto border border-gray-100 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{formMode === 'tx-edit' ? 'Edit Transaction' : 'Add Transaction'}</h3>
            {formError && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{formError}</p>}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Asset Type *</label>
                  <select value={txForm.asset_type} onChange={(e) => setTxForm({ ...txForm, asset_type: e.target.value, fund_id: '' })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    {['bank', 'stock', 'gold'].map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Investment Date *</label>
                  <input type="date" value={txForm.investment_date} max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setTxForm({ ...txForm, investment_date: e.target.value })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount (VND) *</label>
                <input type="number" value={txForm.amount_vnd} onChange={(e) => setTxForm({ ...txForm, amount_vnd: e.target.value })}
                  placeholder="e.g. 10000000" className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Unit Price</label>
                  <input type="number" value={txForm.unit_price} onChange={(e) => setTxForm({ ...txForm, unit_price: e.target.value })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Units</label>
                  <input type="number" value={txForm.units} onChange={(e) => setTxForm({ ...txForm, units: e.target.value })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Interest Rate (%/year)</label>
                <input type="number" step="0.1" value={txForm.interest_rate} onChange={(e) => setTxForm({ ...txForm, interest_rate: e.target.value })}
                  placeholder="e.g. 5.5" className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
                <textarea value={txForm.notes} onChange={(e) => setTxForm({ ...txForm, notes: e.target.value })} rows={2}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setFormMode(null)} className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
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
