'use client'

import { useState, useEffect, useCallback } from 'react'
import ConfirmModal from '@/app/components/ConfirmModal'

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
  expiry_date: string | null
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

const ASSET_LABELS: Record<string, string> = {
  fund: 'Quỹ',
  bank: 'Ngân hàng',
  stock: 'Cổ phiếu',
  gold: 'Vàng',
}

function calcProjectedInterest(amount: number, rate: number | null, investmentDate: string, expiryDate?: string | null): number {
  if (!rate) return 0
  const endMs = expiryDate ? Math.min(Date.now(), new Date(expiryDate).getTime()) : Date.now()
  const days = Math.max(0, (endMs - new Date(investmentDate).getTime()) / (1000 * 60 * 60 * 24))
  const years = days / 365
  return amount * Math.pow(1 + rate / 100, years) - amount
}

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')

const emptyTxForm = { asset_type: 'bank', investment_date: '', amount_vnd: '', unit_price: '', units: '', interest_rate: '', expiry_date: '', notes: '', fund_id: '' }
const emptyFiForm = { fund_id: '', investment_date: '', amount_vnd: '', units: '', unit_price: '' }

export default function GoalDetailView({ goal, onBack }: { goal: Goal; onBack: () => void }) {
  const [currentGoal, setCurrentGoal] = useState(goal)
  const [rows, setRows] = useState<TxRow[]>([])
  const [funds, setFunds] = useState<Fund[]>([])
  const [loading, setLoading] = useState(true)
  const [successMsg, setSuccessMsg] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<{ title: string; message: string; onConfirm: () => Promise<void> } | null>(null)
  const [confirming, setConfirming] = useState(false)

  // Goal edit form
  const [showEditGoal, setShowEditGoal] = useState(false)
  const [editGoalName, setEditGoalName] = useState('')
  const [editGoalDesc, setEditGoalDesc] = useState('')
  const [editGoalTarget, setEditGoalTarget] = useState('')
  const [editGoalError, setEditGoalError] = useState('')
  const [editGoalSaving, setEditGoalSaving] = useState(false)

  // Form mode: null = closed, 'tx-add', 'tx-edit', 'fi-add', 'fi-edit'
  const [formMode, setFormMode] = useState<'tx-add' | 'tx-edit' | 'fi-add' | 'fi-edit' | null>(null)
  const [editTx, setEditTx] = useState<TxRow | null>(null)
  const [txForm, setTxForm] = useState(emptyTxForm)
  const [fiForm, setFiForm] = useState(emptyFiForm)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [txRes, fundsRes, goldPriceRes] = await Promise.all([
      fetch(`/api/v1/investment-transactions?goal_id=${currentGoal.goal_id}&limit=1000`),
      fetch('/api/funds'),
      fetch('/api/v1/gold-price'),
    ])

    const { transactions: txs } = txRes.ok ? await txRes.json() : { transactions: [] }
    const { funds: allFunds } = fundsRes.ok ? await fundsRes.json() : { funds: [] }
    const goldPriceData = goldPriceRes.ok ? await goldPriceRes.json() : null
    const goldPricePerChi: number | null = goldPriceData?.price_per_chi ?? null

    const fundMap: Record<string, Fund> = {}
    for (const f of (allFunds ?? [])) fundMap[f.id] = f
    setFunds(allFunds ?? [])

    const txRows: TxRow[] = (txs ?? []).map((tx: {
      transaction_id: string; asset_type: string; investment_date: string; amount_vnd: number
      unit_price: number | null; units: number | null; interest_rate: number | null; expiry_date: string | null; notes: string | null
      fund_id: string | null; funds?: { id: string; name: string; nav: number } | null
    }) => {
      let currentValue: number
      if (tx.asset_type === 'fund' && tx.units) {
        const fund = Array.isArray(tx.funds) ? tx.funds[0] : tx.funds
        const currentNav = fund?.nav ?? tx.unit_price ?? 0
        currentValue = tx.units * currentNav
      } else if (tx.asset_type === 'gold' && goldPricePerChi && tx.units) {
        currentValue = tx.units * goldPricePerChi
      } else {
        const interest = calcProjectedInterest(tx.amount_vnd, tx.interest_rate, tx.investment_date, tx.expiry_date)
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
        expiry_date: tx.expiry_date,
        notes: tx.notes,
        fund_id: tx.fund_id,
        fund_display: tx.fund_id && fundMap[tx.fund_id] ? `${fundMap[tx.fund_id].code} - ${fundMap[tx.fund_id].name}` : undefined,
        current_value: currentValue,
      }
    })

    setRows(txRows)
    setLoading(false)
  }, [currentGoal.goal_id])

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
      expiry_date: row.expiry_date ?? '',
      notes: row.notes ?? '',
      fund_id: row.fund_id ?? '',
    })
    setEditTx(row)
    setFormError('')
    setFormMode('tx-edit')
  }

  async function handleTxSave() {
    setFormError('')
    if (!txForm.amount_vnd || Number(txForm.amount_vnd) <= 0) { setFormError('Số tiền phải lớn hơn 0.'); return }
    if (!txForm.investment_date) { setFormError('Ngày đầu tư là bắt buộc.'); return }
    const payload = {
      goal_id: currentGoal.goal_id,
      asset_type: txForm.asset_type,
      investment_date: txForm.investment_date,
      amount_vnd: Number(txForm.amount_vnd),
      unit_price: txForm.unit_price ? Number(txForm.unit_price) : null,
      units: txForm.units ? Number(txForm.units) : null,
      interest_rate: txForm.interest_rate ? Number(txForm.interest_rate) : null,
      expiry_date: txForm.asset_type === 'bank' ? (txForm.expiry_date || null) : null,
      notes: txForm.notes || null,
      fund_id: txForm.asset_type === 'fund' ? (txForm.fund_id || null) : null,
    }
    setSaving(true)
    const url = editTx ? `/api/v1/investment-transactions/${editTx.transaction_id}` : '/api/v1/investment-transactions'
    const res = await fetch(url, { method: editTx ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (!res.ok) { const { error } = await res.json(); setFormError(error ?? 'Đã xảy ra lỗi.') }
    else { setFormMode(null); await fetchData() }
    setSaving(false)
  }

  async function handleTxDelete(row: TxRow) {
    setPendingConfirm({
      title: 'Xóa Giao dịch',
      message: 'Bạn có chắc muốn xóa giao dịch đầu tư này?',
      onConfirm: async () => {
        setDeletingId(row.transaction_id)
        const res = await fetch(`/api/v1/investment-transactions/${row.transaction_id}`, { method: 'DELETE' })
        if (res.ok) { setSuccessMsg('Đã xóa giao dịch.'); setTimeout(() => setSuccessMsg(''), 4000); await fetchData() }
        setDeletingId(null)
      },
    })
  }

  // --- Fund investment handlers ---
  function openFiAdd() {
    setFiForm({ ...emptyFiForm, investment_date: new Date().toISOString().slice(0, 10) })
    setEditTx(null)
    setFormError('')
    setFormMode('fi-add')
  }

  function openFiEdit(row: TxRow) {
    setFiForm({
      fund_id: row.fund_id ?? '',
      investment_date: row.investment_date,
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
    if (!fiForm.fund_id) { setFormError('Vui lòng chọn quỹ.'); return }
    if (!fiForm.amount_vnd || Number(fiForm.amount_vnd) <= 0) { setFormError('Số tiền phải lớn hơn 0.'); return }
    if (!fiForm.units || Number(fiForm.units) <= 0) { setFormError('Số CCQ phải lớn hơn 0.'); return }
    if (!fiForm.unit_price || Number(fiForm.unit_price) <= 0) { setFormError('NAV khi mua phải dương.'); return }

    const payload = {
      asset_type: 'fund',
      fund_id: fiForm.fund_id,
      goal_id: currentGoal.goal_id,
      amount_vnd: Number(fiForm.amount_vnd),
      units: Number(fiForm.units),
      unit_price: Number(fiForm.unit_price),
      investment_date: fiForm.investment_date || new Date().toISOString().slice(0, 10),
    }
    setSaving(true)
    const url = editTx ? `/api/v1/investment-transactions/${editTx.transaction_id}` : '/api/v1/investment-transactions'
    const res = await fetch(url, { method: editTx ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (!res.ok) { const { error } = await res.json(); setFormError(error ?? 'Đã xảy ra lỗi.') }
    else { setFormMode(null); await fetchData() }
    setSaving(false)
  }

  async function handleFiDelete(row: TxRow) {
    setPendingConfirm({
      title: 'Xóa Khoản Đầu tư Quỹ',
      message: 'Bạn có chắc muốn xóa khoản đầu tư quỹ này?',
      onConfirm: async () => {
        setDeletingId(row.transaction_id)
        const res = await fetch(`/api/v1/investment-transactions/${row.transaction_id}`, { method: 'DELETE' })
        if (res.ok) {
          setSuccessMsg('Đã xóa khoản đầu tư.')
          setTimeout(() => setSuccessMsg(''), 4000)
          await fetchData()
        }
        setDeletingId(null)
      },
    })
  }

  async function handleUnassign(row: TxRow) {
    setPendingConfirm({
      title: 'Bỏ gán Giao dịch',
      message: 'Bạn có chắc muốn bỏ gán giao dịch này khỏi mục tiêu?',
      onConfirm: async () => {
        const res = await fetch(`/api/v1/investment-transactions/${row.transaction_id}/assign`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goal_id: null }),
        })
        if (res.ok) {
          setSuccessMsg('Đã bỏ gán khỏi mục tiêu.')
          setTimeout(() => setSuccessMsg(''), 4000)
          await fetchData()
        }
      },
    })
  }

  function openEditGoal() {
    setEditGoalName(currentGoal.goal_name)
    setEditGoalDesc(currentGoal.description ?? '')
    setEditGoalTarget(currentGoal.target_amount != null ? String(currentGoal.target_amount) : '')
    setEditGoalError('')
    setShowEditGoal(true)
  }

  async function handleEditGoalSave() {
    if (!editGoalName.trim()) { setEditGoalError('Tên mục tiêu là bắt buộc.'); return }
    setEditGoalSaving(true)
    setEditGoalError('')
    const res = await fetch(`/api/v1/savings-goals/${currentGoal.goal_id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal_name: editGoalName, description: editGoalDesc, target_amount: editGoalTarget || null }),
    })
    if (!res.ok) {
      const { error } = await res.json()
      setEditGoalError(error ?? 'Đã xảy ra lỗi.')
    } else {
      const updated = await res.json()
      setCurrentGoal({ ...currentGoal, goal_name: updated.goal_name, description: updated.description, target_amount: updated.target_amount })
      setShowEditGoal(false)
    }
    setEditGoalSaving(false)
  }

  function handleDeleteGoal() {
    setPendingConfirm({
      title: 'Xóa Mục tiêu',
      message: `${rows.length} giao dịch trong mục tiêu này sẽ bị bỏ gán.`,
      onConfirm: async () => {
        const res = await fetch(`/api/v1/savings-goals/${currentGoal.goal_id}`, { method: 'DELETE' })
        if (res.ok) onBack()
      },
    })
  }

  const fundRows = rows.filter((r) => r._source === 'fund')
  const otherRows = rows.filter((r) => r._source === 'other')

  const totalInvested = rows.reduce((s, r) => s + r.amount_vnd, 0)
  const totalCurrentValue = rows.reduce((s, r) => s + r.current_value, 0)
  const totalGain = totalCurrentValue - totalInvested

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium">← Quay lại</button>
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{currentGoal.goal_name}</h2>
            {currentGoal.description && <p className="text-sm text-gray-500 dark:text-gray-400">{currentGoal.description}</p>}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={openEditGoal} className="px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Sửa</button>
          <button onClick={handleDeleteGoal} className="px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20">Xóa</button>
        </div>
      </div>

      {successMsg && (
        <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-300 rounded-lg text-sm">{successMsg}</div>
      )}

      {/* Goal Progress */}
      {currentGoal.target_amount != null && (
        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 mb-6">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-medium text-gray-700 dark:text-gray-300">Tiến độ Mục tiêu</span>
            <span className="text-gray-500 dark:text-gray-400">
              {fmt(totalCurrentValue)} / {fmt(currentGoal.target_amount)}
            </span>
          </div>
          {(() => {
            const pct = Math.min((totalCurrentValue / currentGoal.target_amount!) * 100, 100)
            const exceeded = totalCurrentValue >= currentGoal.target_amount!
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
                    ? <span className="text-green-600 dark:text-green-400 font-medium">Đã đạt mục tiêu!</span>
                    : <span>{fmt(currentGoal.target_amount! - totalCurrentValue)} còn lại</span>
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
          { label: 'Giá trị Hiện tại', value: fmt(totalCurrentValue) },
          { label: 'Tổng Đầu tư', value: fmt(totalInvested) },
          { label: 'Lãi / Lỗ', value: fmt(totalGain) },
        ].map((item) => (
          <div key={item.label} className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 text-center">
            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide mb-1">{item.label}</p>
            <p className={`text-xl font-bold ${item.label === 'Lãi / Lỗ' ? (totalGain >= 0 ? 'text-green-600' : 'text-red-600') : 'text-indigo-700 dark:text-indigo-300'}`}>
              {item.value}
            </p>
          </div>
        ))}
      </div>

      {/* Fund Investments */}
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden mb-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">Đầu tư Quỹ</h3>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Từ Cài đặt và Kế hoạch Tháng</p>
          </div>
          <button onClick={openFiAdd} className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700">
            Thêm Đầu tư Quỹ
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">Đang tải...</div>
        ) : fundRows.length === 0 ? (
          <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">Chưa có đầu tư quỹ nào.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  {['Ngày', 'Quỹ', 'Số tiền', 'CCQ', 'NAV khi Mua', 'NAV Hiện tại', 'Giá trị Hiện tại', 'Lãi/Lỗ', 'Thao tác'].map((h) => (
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
                          <button onClick={() => openFiEdit(row)} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Sửa</button>
                          <button onClick={() => handleUnassign(row)} className="text-xs text-amber-600 dark:text-amber-400 hover:underline">Bỏ gán</button>
                          <button onClick={() => handleFiDelete(row)} disabled={deletingId === row.transaction_id} className="text-xs text-red-500 dark:text-red-400 hover:underline disabled:opacity-50">
                            {deletingId === row.transaction_id ? 'Đang xóa...' : 'Xóa'}
                          </button>
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
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">Giao dịch Khác</h3>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Tiết kiệm ngân hàng, cổ phiếu, vàng</p>
          </div>
          <button onClick={openTxAdd} className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700">
            Thêm Giao dịch
          </button>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">Đang tải...</div>
        ) : otherRows.length === 0 ? (
          <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">Chưa có giao dịch nào.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  {['Ngày', 'Loại', 'Số tiền', 'Đơn vị', 'Lãi suất', 'Lãi/Lỗ', 'Ghi chú', 'Thao tác'].map((h) => (
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
                          {ASSET_LABELS[row.asset_type] ?? row.asset_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{fmt(row.amount_vnd)}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{row.units ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{row.interest_rate != null ? `${row.interest_rate}%` : '—'}</td>
                      <td className={`px-4 py-3 font-medium ${gain >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(gain)}</td>
                      <td className="px-4 py-3 text-gray-400 dark:text-gray-500 max-w-32 truncate">{row.notes ?? '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button onClick={() => openTxEdit(row)} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Sửa</button>
                          <button onClick={() => handleUnassign(row)} className="text-xs text-amber-600 dark:text-amber-400 hover:underline">Bỏ gán</button>
                          <button onClick={() => handleTxDelete(row)} disabled={deletingId === row.transaction_id} className="text-xs text-red-500 dark:text-red-400 hover:underline disabled:opacity-50">
                            {deletingId === row.transaction_id ? 'Đang xóa...' : 'Xóa'}
                          </button>
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

      {/* Edit Goal Modal */}
      {showEditGoal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={(e) => { e.preventDefault(); handleEditGoalSave() }} className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-6 border border-gray-100 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Sửa Mục tiêu</h3>
            {editGoalError && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{editGoalError}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tên Mục tiêu *</label>
                <input type="text" value={editGoalName} onChange={(e) => setEditGoalName(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Số tiền Mục tiêu (VND)</label>
                <input type="number" value={editGoalTarget} onChange={(e) => setEditGoalTarget(e.target.value)}
                  placeholder="Tùy chọn"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mô tả</label>
                <textarea value={editGoalDesc} onChange={(e) => setEditGoalDesc(e.target.value)} rows={3}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button type="button" onClick={() => setShowEditGoal(false)} className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Hủy</button>
              <button type="submit" disabled={editGoalSaving} className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {editGoalSaving ? 'Đang lưu...' : 'Lưu'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Fund Investment Add/Edit Modal */}
      {(formMode === 'fi-add' || formMode === 'fi-edit') && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-6 border border-gray-100 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{formMode === 'fi-edit' ? 'Sửa Đầu tư Quỹ' : 'Thêm Đầu tư Quỹ'}</h3>
            {formError && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{formError}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Quỹ *</label>
                <select
                  value={fiForm.fund_id}
                  onChange={(e) => setFiForm({ ...fiForm, fund_id: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Chọn quỹ...</option>
                  {funds.map((f) => <option key={f.id} value={f.id}>{f.code} - {f.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Ngày Đầu tư *</label>
                <input type="date" value={fiForm.investment_date} max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setFiForm({ ...fiForm, investment_date: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Số tiền (VND) *</label>
                <input type="number" value={fiForm.amount_vnd} onChange={(e) => setFiForm({ ...fiForm, amount_vnd: e.target.value })}
                  placeholder="VD: 10000000" className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Số CCQ *</label>
                  <input type="number" value={fiForm.units} onChange={(e) => setFiForm({ ...fiForm, units: e.target.value })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">NAV khi Mua *</label>
                  <input type="number" value={fiForm.unit_price} onChange={(e) => setFiForm({ ...fiForm, unit_price: e.target.value })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setFormMode(null)} className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Hủy</button>
              <button onClick={handleFiSave} disabled={saving} className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Đang lưu...' : 'Lưu'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Other Transaction Add/Edit Modal */}
      {(formMode === 'tx-add' || formMode === 'tx-edit') && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto border border-gray-100 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{formMode === 'tx-edit' ? 'Sửa Giao dịch' : 'Thêm Giao dịch'}</h3>
            {formError && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{formError}</p>}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Loại Tài sản *</label>
                  <select value={txForm.asset_type} onChange={(e) => setTxForm({ ...txForm, asset_type: e.target.value, fund_id: '' })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    {[{ v: 'bank', l: 'Ngân hàng' }, { v: 'stock', l: 'Cổ phiếu' }, { v: 'gold', l: 'Vàng' }].map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Ngày Đầu tư *</label>
                  <input type="date" value={txForm.investment_date} max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setTxForm({ ...txForm, investment_date: e.target.value })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Số tiền (VND) *</label>
                <input type="number" value={txForm.amount_vnd} onChange={(e) => setTxForm({ ...txForm, amount_vnd: e.target.value })}
                  placeholder="VD: 10000000" className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Giá Đơn vị</label>
                  <input type="number" value={txForm.unit_price} onChange={(e) => setTxForm({ ...txForm, unit_price: e.target.value })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{txForm.asset_type === 'stock' ? 'CP' : txForm.asset_type === 'gold' ? 'Chỉ' : 'Đơn vị'}</label>
                  <input type="number" value={txForm.units} onChange={(e) => setTxForm({ ...txForm, units: e.target.value })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Lãi suất (%/năm)</label>
                <input type="number" step="0.1" value={txForm.interest_rate} onChange={(e) => setTxForm({ ...txForm, interest_rate: e.target.value })}
                  placeholder="VD: 5.5" className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              {txForm.asset_type === 'bank' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Ngày Đáo hạn</label>
                  <input type="date" value={txForm.expiry_date} onChange={(e) => setTxForm({ ...txForm, expiry_date: e.target.value })}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Ghi chú</label>
                <textarea value={txForm.notes} onChange={(e) => setTxForm({ ...txForm, notes: e.target.value })} rows={2}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setFormMode(null)} className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Hủy</button>
              <button onClick={handleTxSave} disabled={saving} className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Đang lưu...' : 'Lưu'}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingConfirm && (
        <ConfirmModal
          title={pendingConfirm.title}
          message={pendingConfirm.message}
          confirming={confirming}
          onConfirm={async () => {
            setConfirming(true)
            await pendingConfirm.onConfirm()
            setConfirming(false)
            setPendingConfirm(null)
          }}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </div>
  )
}
