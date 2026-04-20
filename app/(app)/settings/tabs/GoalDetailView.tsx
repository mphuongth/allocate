'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { ArrowLeft, Edit, Trash2, Plus, Unlink, TrendingDown } from 'lucide-react'
import ConfirmModal from '@/app/components/ConfirmModal'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

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
  fund_code: string | null
  // Aggregated withdrawal data for this transaction
  total_principal_withdrawn: number
  total_units_withdrawn: number
  total_received: number
}

interface WithdrawalRow {
  transaction_id: string
  investment_date: string
  amount_vnd: number
  principal_withdrawn: number | null
  units_withdrawn: number | null
  parent_transaction_id: string | null
  fund_id: string | null
  notes: string | null
}

interface FundGroup {
  fund_id: string
  fund_code: string
  fund_name: string
  current_nav: number
  total_units_bought: number
  total_cost: number
  avg_cost_per_unit: number
  units_sold: number
  remaining_units: number
  current_value: number
  total_received_from_sells: number
  total_pl: number
}

interface WithdrawSource {
  type: 'bank' | 'gold' | 'fund'
  row?: TxRow
  fund_group?: FundGroup
}

const ASSET_COLORS: Record<string, string> = {
  fund: 'bg-purple-100 text-purple-700',
  bank: 'bg-blue-100 text-blue-700',
  stock: 'bg-green-100 text-green-700',
  gold: 'bg-amber-100 text-amber-700',
}

function calcProjectedInterest(amount: number, rate: number | null, investmentDate: string, expiryDate?: string | null): number {
  if (!rate || amount <= 0) return 0
  const endMs = expiryDate ? Math.min(Date.now(), new Date(expiryDate).getTime()) : Date.now()
  const days = Math.max(0, (endMs - new Date(investmentDate).getTime()) / (1000 * 60 * 60 * 24))
  return amount * Math.pow(1 + rate / 100, days / 365) - amount
}

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')
const fmtUnits = (n: number) => (n % 1 === 0 ? n.toString() : n.toFixed(4))

const emptyTxForm = { asset_type: 'bank', investment_date: '', amount_vnd: '', unit_price: '', units: '', interest_rate: '', expiry_date: '', notes: '', fund_id: '' }
const emptyFiForm = { fund_id: '', investment_date: '', amount_vnd: '', units: '', unit_price: '' }
const emptyWithdrawForm = { investment_date: '', amount_vnd: '', principal_withdrawn: '', units_withdrawn: '', notes: '' }

export default function GoalDetailView({ goal, onBack }: { goal: Goal; onBack: () => void }) {
  const t = useTranslations('goals')
  const tc = useTranslations('common')
  const tt = useTranslations('transactions')
  const [currentGoal, setCurrentGoal] = useState(goal)
  const [investmentRows, setInvestmentRows] = useState<TxRow[]>([])
  const [withdrawalRows, setWithdrawalRows] = useState<WithdrawalRow[]>([])
  const [funds, setFunds] = useState<Fund[]>([])
  const [goldPrice, setGoldPrice] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [successMsg, setSuccessMsg] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<{ title: string; message: string; onConfirm: () => Promise<void> } | null>(null)
  const [confirming, setConfirming] = useState(false)

  const [showEditGoal, setShowEditGoal] = useState(false)
  const [editGoalName, setEditGoalName] = useState('')
  const [editGoalDesc, setEditGoalDesc] = useState('')
  const [editGoalTarget, setEditGoalTarget] = useState('')
  const [editGoalError, setEditGoalError] = useState('')
  const [editGoalSaving, setEditGoalSaving] = useState(false)

  const [activeDetailTab, setActiveDetailTab] = useState<'fund' | 'other'>('fund')
  const [formMode, setFormMode] = useState<'tx-add' | 'tx-edit' | 'fi-add' | 'fi-edit' | 'withdraw' | null>(null)
  const [editTx, setEditTx] = useState<TxRow | null>(null)
  const [txForm, setTxForm] = useState(emptyTxForm)
  const [fiForm, setFiForm] = useState(emptyFiForm)
  const [withdrawSource, setWithdrawSource] = useState<WithdrawSource | null>(null)
  const [withdrawForm, setWithdrawForm] = useState(emptyWithdrawForm)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [txRes, fundsRes, goldRes] = await Promise.all([
      fetch(`/api/v1/investment-transactions?goal_id=${currentGoal.goal_id}&limit=1000`),
      fetch('/api/funds'),
      fetch('/api/v1/gold-price'),
    ])
    const { transactions: txs } = txRes.ok ? await txRes.json() : { transactions: [] }
    const { funds: allFunds } = fundsRes.ok ? await fundsRes.json() : { funds: [] }
    const goldData = goldRes.ok ? await goldRes.json() : null

    setFunds(allFunds ?? [])
    setGoldPrice(goldData?.price_per_chi ?? null)

    const fundMap: Record<string, Fund> = {}
    for (const f of (allFunds ?? [])) fundMap[f.id] = f

    const all = txs ?? []

    const withdrawals: WithdrawalRow[] = all
      .filter((tx: { transaction_type: string }) => tx.transaction_type === 'withdrawal')
      .map((tx: { transaction_id: string; investment_date: string; amount_vnd: number; principal_withdrawn: number | null; units_withdrawn: number | null; parent_transaction_id: string | null; fund_id: string | null; notes: string | null }) => ({
        transaction_id: tx.transaction_id,
        investment_date: tx.investment_date,
        amount_vnd: tx.amount_vnd,
        principal_withdrawn: tx.principal_withdrawn,
        units_withdrawn: tx.units_withdrawn,
        parent_transaction_id: tx.parent_transaction_id,
        fund_id: tx.fund_id,
        notes: tx.notes,
      }))

    // Build withdrawal lookup by parent transaction
    const byParent: Record<string, WithdrawalRow[]> = {}
    for (const w of withdrawals) {
      if (w.parent_transaction_id) {
        if (!byParent[w.parent_transaction_id]) byParent[w.parent_transaction_id] = []
        byParent[w.parent_transaction_id].push(w)
      }
    }

    const investments: TxRow[] = all
      .filter((tx: { transaction_type: string }) => tx.transaction_type !== 'withdrawal')
      .map((tx: { transaction_id: string; asset_type: string; investment_date: string; amount_vnd: number; unit_price: number | null; units: number | null; interest_rate: number | null; expiry_date: string | null; notes: string | null; fund_id: string | null }) => {
        const ws = byParent[tx.transaction_id] ?? []
        return {
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
          fund_code: tx.fund_id && fundMap[tx.fund_id] ? fundMap[tx.fund_id].code : null,
          total_principal_withdrawn: ws.reduce((s: number, w: WithdrawalRow) => s + (w.principal_withdrawn ?? 0), 0),
          total_units_withdrawn: ws.reduce((s: number, w: WithdrawalRow) => s + (w.units_withdrawn ?? 0), 0),
          total_received: ws.reduce((s: number, w: WithdrawalRow) => s + w.amount_vnd, 0),
        }
      })

    setInvestmentRows(investments)
    setWithdrawalRows(withdrawals)
    setLoading(false)
  }, [currentGoal.goal_id])

  useEffect(() => { fetchData() }, [fetchData])

  // --- Computed ---
  const fundInvestmentRows = investmentRows.filter(r => r.asset_type === 'fund')
  const otherRows = investmentRows.filter(r => r.asset_type !== 'fund')

  // Build fund groups
  const fundGroupMap: Record<string, FundGroup> = {}
  for (const row of fundInvestmentRows) {
    if (!row.fund_id) continue
    if (!fundGroupMap[row.fund_id]) {
      const fund = funds.find(f => f.id === row.fund_id)
      fundGroupMap[row.fund_id] = {
        fund_id: row.fund_id,
        fund_code: fund?.code ?? row.fund_code ?? row.fund_id,
        fund_name: fund?.name ?? row.fund_id,
        current_nav: fund?.nav ?? 0,
        total_units_bought: 0, total_cost: 0, avg_cost_per_unit: 0,
        units_sold: 0, remaining_units: 0, current_value: 0,
        total_received_from_sells: 0, total_pl: 0,
      }
    }
    const g = fundGroupMap[row.fund_id]
    g.total_units_bought += row.units ?? 0
    g.total_cost += row.amount_vnd
  }
  // Add fund sell withdrawals (no parent_transaction_id = fund-level sell)
  for (const w of withdrawalRows) {
    if (w.fund_id && !w.parent_transaction_id && fundGroupMap[w.fund_id]) {
      fundGroupMap[w.fund_id].units_sold += w.units_withdrawn ?? 0
      fundGroupMap[w.fund_id].total_received_from_sells += w.amount_vnd
    }
  }
  const fundGroups: FundGroup[] = Object.values(fundGroupMap).map(g => {
    g.avg_cost_per_unit = g.total_units_bought > 0 ? g.total_cost / g.total_units_bought : 0
    g.remaining_units = Math.max(0, g.total_units_bought - g.units_sold)
    g.current_value = g.remaining_units * g.current_nav
    const realized = g.total_received_from_sells - g.units_sold * g.avg_cost_per_unit
    const unrealized = g.current_value - g.remaining_units * g.avg_cost_per_unit
    g.total_pl = realized + unrealized
    return g
  })

  function getOtherCurrentValue(row: TxRow): number {
    if (row.asset_type === 'gold' && goldPrice && row.units) {
      return Math.max(0, (row.units - row.total_units_withdrawn) * goldPrice)
    }
    const rem = row.amount_vnd - row.total_principal_withdrawn
    return Math.max(0, rem + calcProjectedInterest(rem, row.interest_rate, row.investment_date, row.expiry_date))
  }

  const totalFundCurrentValue = fundGroups.reduce((s, g) => s + g.current_value, 0)
  const totalOtherCurrentValue = otherRows.reduce((s, r) => s + getOtherCurrentValue(r), 0)
  const totalCurrentValue = totalFundCurrentValue + totalOtherCurrentValue
  const totalInvested = investmentRows.reduce((s, r) => s + r.amount_vnd, 0)
  const totalWithdrawn = withdrawalRows.reduce((s, w) => s + w.amount_vnd, 0)
  const totalGain = totalCurrentValue + totalWithdrawn - totalInvested

  // --- Fund investment handlers ---
  function openFiAdd() {
    setFiForm({ ...emptyFiForm, investment_date: new Date().toISOString().slice(0, 10) })
    setEditTx(null); setFormError(''); setFormMode('fi-add')
  }
  async function handleFiSave() {
    setFormError('')
    if (!fiForm.fund_id) { setFormError(t('selectFundRequired')); return }
    if (!fiForm.amount_vnd || Number(fiForm.amount_vnd) <= 0) { setFormError(t('amountRequired')); return }
    if (!fiForm.units || Number(fiForm.units) <= 0) { setFormError(t('unitsRequired')); return }
    if (!fiForm.unit_price || Number(fiForm.unit_price) <= 0) { setFormError(t('navRequired')); return }
    const payload = { asset_type: 'fund', fund_id: fiForm.fund_id, goal_id: currentGoal.goal_id, amount_vnd: Number(fiForm.amount_vnd), units: Number(fiForm.units), unit_price: Number(fiForm.unit_price), investment_date: fiForm.investment_date || new Date().toISOString().slice(0, 10) }
    setSaving(true)
    const url = editTx ? `/api/v1/investment-transactions/${editTx.transaction_id}` : '/api/v1/investment-transactions'
    const res = await fetch(url, { method: editTx ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (!res.ok) { const { error } = await res.json(); setFormError(error ?? tc('error')) }
    else { setFormMode(null); await fetchData() }
    setSaving(false)
  }

  // --- Other tx handlers ---
  function openTxAdd() {
    setTxForm({ ...emptyTxForm, investment_date: new Date().toISOString().slice(0, 10) })
    setEditTx(null); setFormError(''); setFormMode('tx-add')
  }
  function openTxEdit(row: TxRow) {
    setTxForm({ asset_type: row.asset_type, investment_date: row.investment_date, amount_vnd: String(row.amount_vnd), unit_price: row.unit_price != null ? String(row.unit_price) : '', units: row.units != null ? String(row.units) : '', interest_rate: row.interest_rate != null ? String(row.interest_rate) : '', expiry_date: row.expiry_date ?? '', notes: row.notes ?? '', fund_id: row.fund_id ?? '' })
    setEditTx(row); setFormError(''); setFormMode('tx-edit')
  }
  async function handleTxSave() {
    setFormError('')
    if (!txForm.amount_vnd || Number(txForm.amount_vnd) <= 0) { setFormError(t('amountRequired')); return }
    if (!txForm.investment_date) { setFormError(t('dateRequired')); return }
    const payload = { goal_id: currentGoal.goal_id, asset_type: txForm.asset_type, investment_date: txForm.investment_date, amount_vnd: Number(txForm.amount_vnd), unit_price: txForm.unit_price ? Number(txForm.unit_price) : null, units: txForm.units ? Number(txForm.units) : null, interest_rate: txForm.interest_rate ? Number(txForm.interest_rate) : null, expiry_date: txForm.asset_type === 'bank' ? (txForm.expiry_date || null) : null, notes: txForm.notes || null, fund_id: txForm.asset_type === 'fund' ? (txForm.fund_id || null) : null }
    setSaving(true)
    const url = editTx ? `/api/v1/investment-transactions/${editTx.transaction_id}` : '/api/v1/investment-transactions'
    const res = await fetch(url, { method: editTx ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (!res.ok) { const { error } = await res.json(); setFormError(error ?? tc('error')) }
    else { setFormMode(null); await fetchData() }
    setSaving(false)
  }
  async function handleTxDelete(row: TxRow) {
    setPendingConfirm({ title: t('deleteTxModal'), message: t('deleteTxMessage'), onConfirm: async () => {
      setDeletingId(row.transaction_id)
      const res = await fetch(`/api/v1/investment-transactions/${row.transaction_id}`, { method: 'DELETE' })
      if (res.ok) { setSuccessMsg(t('deletedTx')); setTimeout(() => setSuccessMsg(''), 4000); await fetchData() }
      setDeletingId(null)
    }})
  }

  async function handleUnassign(row: TxRow) {
    setPendingConfirm({ title: t('unassignTitle'), message: t('unassignMessage'), onConfirm: async () => {
      const res = await fetch(`/api/v1/investment-transactions/${row.transaction_id}/assign`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goal_id: null }) })
      if (res.ok) { setSuccessMsg(t('unassignSuccess')); setTimeout(() => setSuccessMsg(''), 4000); await fetchData() }
    }})
  }

  // --- Withdraw/Sell handlers ---
  function openWithdrawFund(group: FundGroup) {
    setWithdrawSource({ type: 'fund', fund_group: group })
    setWithdrawForm({ ...emptyWithdrawForm, investment_date: new Date().toISOString().slice(0, 10) })
    setFormError('')
    setFormMode('withdraw')
  }
  function openWithdrawOther(row: TxRow) {
    const type = row.asset_type === 'gold' ? 'gold' : 'bank'
    setWithdrawSource({ type, row })
    const base = { ...emptyWithdrawForm, investment_date: new Date().toISOString().slice(0, 10) }
    if (type === 'bank') {
      const remainingPrincipal = Math.max(0, row.amount_vnd - row.total_principal_withdrawn)
      const interest = calcProjectedInterest(remainingPrincipal, row.interest_rate, row.investment_date, row.expiry_date)
      base.principal_withdrawn = String(Math.round(remainingPrincipal))
      base.amount_vnd = String(Math.round(remainingPrincipal + interest))
    }
    setWithdrawForm(base)
    setFormError('')
    setFormMode('withdraw')
  }

  async function handleWithdrawSave() {
    setFormError('')
    if (!withdrawSource) return
    if (!withdrawForm.investment_date) { setFormError(t('dateRequired')); return }
    if (!withdrawForm.amount_vnd || Number(withdrawForm.amount_vnd) <= 0) { setFormError(t('amountRequired')); return }

    const { type } = withdrawSource

    if (type === 'bank') {
      if (!withdrawForm.principal_withdrawn || Number(withdrawForm.principal_withdrawn) <= 0) {
        setFormError('Vui lòng nhập vốn rút'); return
      }
    }
    if (type === 'fund' || type === 'gold') {
      if (!withdrawForm.units_withdrawn || Number(withdrawForm.units_withdrawn) <= 0) {
        setFormError(type === 'fund' ? 'Vui lòng nhập số đơn vị bán' : 'Vui lòng nhập số chi vàng bán'); return
      }
    }

    const principalWithdrawn = Math.round(
      type === 'bank'
        ? Number(withdrawForm.principal_withdrawn)
        : type === 'fund' && withdrawSource.fund_group
          ? Number(withdrawForm.units_withdrawn) * withdrawSource.fund_group.avg_cost_per_unit
          : type === 'gold' && withdrawSource.row
            ? Number(withdrawForm.units_withdrawn) * (withdrawSource.row.unit_price ?? 0)
            : 0
    )

    const payload = {
      transaction_type: 'withdrawal',
      goal_id: currentGoal.goal_id,
      investment_date: withdrawForm.investment_date,
      amount_vnd: Number(withdrawForm.amount_vnd),
      principal_withdrawn: principalWithdrawn,
      units_withdrawn: (type === 'fund' || type === 'gold') ? Number(withdrawForm.units_withdrawn) : null,
      notes: withdrawForm.notes || null,
      // For bank/gold: link to parent transaction
      parent_transaction_id: (type === 'bank' || type === 'gold') ? withdrawSource.row?.transaction_id : null,
      // For fund: store fund_id and asset_type for grouping
      asset_type: type === 'fund' ? 'fund' : null,
      fund_id: type === 'fund' ? withdrawSource.fund_group?.fund_id : null,
    }

    setSaving(true)
    const res = await fetch('/api/v1/investment-transactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (!res.ok) { const { error } = await res.json(); setFormError(error ?? tc('error')) }
    else { setFormMode(null); setWithdrawSource(null); await fetchData() }
    setSaving(false)
  }

  async function handleWithdrawalDelete(w: WithdrawalRow) {
    setPendingConfirm({ title: 'Xóa giao dịch rút', message: 'Bạn có chắc muốn xóa giao dịch rút/bán này?', onConfirm: async () => {
      const res = await fetch(`/api/v1/investment-transactions/${w.transaction_id}`, { method: 'DELETE' })
      if (res.ok) { setSuccessMsg(t('deletedWithdrawal')); setTimeout(() => setSuccessMsg(''), 4000); await fetchData() }
    }})
  }

  // --- Goal edit/delete ---
  function openEditGoal() {
    setEditGoalName(currentGoal.goal_name); setEditGoalDesc(currentGoal.description ?? ''); setEditGoalTarget(currentGoal.target_amount != null ? String(currentGoal.target_amount) : ''); setEditGoalError(''); setShowEditGoal(true)
  }
  async function handleEditGoalSave() {
    if (!editGoalName.trim()) { setEditGoalError(t('nameRequired')); return }
    setEditGoalSaving(true); setEditGoalError('')
    const res = await fetch(`/api/v1/savings-goals/${currentGoal.goal_id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goal_name: editGoalName, description: editGoalDesc, target_amount: editGoalTarget || null }) })
    if (!res.ok) { const { error } = await res.json(); setEditGoalError(error ?? tc('error')) }
    else { const updated = await res.json(); setCurrentGoal({ ...currentGoal, goal_name: updated.goal_name, description: updated.description, target_amount: updated.target_amount }); setShowEditGoal(false) }
    setEditGoalSaving(false)
  }
  function handleDeleteGoal() {
    setPendingConfirm({ title: t('deleteModal'), message: t('deleteMessage', { count: investmentRows.length }), onConfirm: async () => {
      const res = await fetch(`/api/v1/savings-goals/${currentGoal.goal_id}`, { method: 'DELETE' })
      if (res.ok) onBack()
    }})
  }

  // --- Withdraw form helpers ---
  const wSrc = withdrawSource
  const wType = wSrc?.type
  const wGroup = wSrc?.fund_group
  const wRow = wSrc?.row
  const wUnitsNum = Number(withdrawForm.units_withdrawn) || 0
  const wAmtNum = Number(withdrawForm.amount_vnd) || 0
  const wPrinNum = wType === 'bank' ? (Number(withdrawForm.principal_withdrawn) || 0) : wType === 'fund' && wGroup ? wUnitsNum * wGroup.avg_cost_per_unit : wType === 'gold' && wRow ? wUnitsNum * (wRow.unit_price ?? 0) : 0
  const wGain = wAmtNum - wPrinNum
  const wRemainingUnits = wType === 'fund' && wGroup ? wGroup.remaining_units - wUnitsNum : wType === 'gold' && wRow ? ((wRow.units ?? 0) - wRow.total_units_withdrawn - wUnitsNum) : null
  const wRemainingPrincipal = wType === 'bank' && wRow ? (wRow.amount_vnd - wRow.total_principal_withdrawn - (Number(withdrawForm.principal_withdrawn) || 0)) : null

  // Withdraw modal title
  const withdrawModalTitle = wType === 'fund' ? t('sellModal') : wType === 'gold' ? t('sellGoldModal') : t('withdrawBankModal')

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={onBack} className="p-1.5 rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{currentGoal.goal_name}</h2>
            <button onClick={openEditGoal} className="p-1.5 rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              <Edit className="h-4 w-4" />
            </button>
            <button onClick={handleDeleteGoal} className="p-1.5 rounded-md text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          {currentGoal.description && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{currentGoal.description}</p>}
        </div>
      </div>

      {successMsg && (
        <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-300 rounded-lg text-sm">{successMsg}</div>
      )}

      {/* Goal Progress */}
      {currentGoal.target_amount != null && (
        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 mb-6">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-medium text-gray-700 dark:text-gray-300">{t('progress')}</span>
            <span className="text-gray-500 dark:text-gray-400">{fmt(totalCurrentValue)} / {fmt(currentGoal.target_amount)}</span>
          </div>
          {(() => {
            const pct = Math.min((totalCurrentValue / currentGoal.target_amount!) * 100, 100)
            const exceeded = totalCurrentValue >= currentGoal.target_amount!
            return (
              <>
                <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${exceeded ? 'bg-green-500' : 'bg-indigo-500'}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="flex items-center justify-between mt-1.5 text-xs text-gray-400 dark:text-gray-500">
                  <span>{Math.round(pct)}%</span>
                  {exceeded ? <span className="text-green-600 dark:text-green-400 font-medium">{t('goalReached')}</span> : <span>{t('remaining', { amount: fmt(currentGoal.target_amount! - totalCurrentValue) })}</span>}
                </div>
              </>
            )
          })()}
        </div>
      )}

      {/* Summary cards */}
      <div className={`grid gap-4 mb-6 ${totalWithdrawn > 0 ? 'grid-cols-2 md:grid-cols-4' : 'md:grid-cols-3 grid-cols-1'}`}>
        <div className="px-5 py-6 rounded-xl border border-blue-200 dark:border-blue-800 bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20">
          <p className="text-xs uppercase tracking-wide text-blue-700 dark:text-blue-400 mb-1">{t('currentValue')}</p>
          <p className="text-2xl font-bold text-blue-900 dark:text-blue-200">{fmt(totalCurrentValue)}</p>
        </div>
        <div className="px-5 py-6 rounded-xl border border-purple-200 dark:border-purple-800 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20">
          <p className="text-xs uppercase tracking-wide text-purple-700 dark:text-purple-400 mb-1">{t('totalInvested')}</p>
          <p className="text-2xl font-bold text-purple-900 dark:text-purple-200">{fmt(totalInvested)}</p>
        </div>
        {totalWithdrawn > 0 && (
          <div className="px-5 py-6 rounded-xl border border-amber-200 dark:border-amber-800 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20">
            <p className="text-xs uppercase tracking-wide text-amber-700 dark:text-amber-400 mb-1">{t('withdrawn')}</p>
            <p className="text-2xl font-bold text-amber-900 dark:text-amber-200">{fmt(totalWithdrawn)}</p>
          </div>
        )}
        <div className={`px-5 py-6 rounded-xl border ${totalGain >= 0 ? 'border-green-200 dark:border-green-800 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20' : 'border-red-200 dark:border-red-800 bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-900/20 dark:to-rose-900/20'}`}>
          <p className={`text-xs uppercase tracking-wide mb-1 ${totalGain >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>{t('gainLoss')}</p>
          <p className={`text-2xl font-bold ${totalGain >= 0 ? 'text-green-900 dark:text-green-200' : 'text-red-900 dark:text-red-200'}`}>{fmt(totalGain)}</p>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="inline-flex h-9 items-center bg-[#ececf0] dark:bg-gray-800 rounded-xl p-[3px] mb-4">
        {(['fund', 'other'] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveDetailTab(tab)}
            className={`inline-flex h-[calc(100%-1px)] items-center justify-center whitespace-nowrap rounded-xl border px-3 py-1 text-sm font-medium transition-[color,box-shadow] ${activeDetailTab === tab ? 'border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm' : 'border-transparent text-gray-900 dark:text-gray-400'}`}>
            {tab === 'fund' ? t('fundInvestments') : t('otherInvestments')}
          </button>
        ))}
      </div>

      {/* Fund Investments Tab — grouped by fund */}
      {activeDetailTab === 'fund' && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-black/10 dark:border-gray-700 overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-5 py-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('fundInvestments')}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('fundInvestmentsSub')}</p>
            </div>
            <button onClick={openFiAdd} className="flex items-center gap-2 h-9 px-3 sm:px-4 bg-gray-950 hover:bg-gray-800 text-white text-sm font-bold rounded-md transition-colors shrink-0 self-start sm:self-auto">
              <Plus className="h-4 w-4 shrink-0" /><span className="hidden sm:inline">{t('addFundBtn')}</span>
            </button>
          </div>

          {loading ? (
            <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">{tc('loading')}</div>
          ) : fundGroups.length === 0 ? (
            <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">{t('noFundInvestments')}</div>
          ) : (
            <>
              {/* Mobile: fund group cards */}
              <div className="sm:hidden divide-y divide-black/5 dark:divide-gray-700">
                {fundGroups.map((g) => (
                  <div key={g.fund_id} className="px-4 py-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{g.fund_code}</span>
                        <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">{g.fund_name}</span>
                      </div>
                      {g.remaining_units === 0 && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 shrink-0">{t('fullySold')}</span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <div><span className="text-gray-500 dark:text-gray-400">{t('colRemaining')}: </span><span className="font-medium text-gray-900 dark:text-gray-100">{fmtUnits(g.remaining_units)} {t('unitsShort')}</span></div>
                      <div><span className="text-gray-500 dark:text-gray-400">{t('colValue')}: </span><span className="font-medium text-gray-900 dark:text-gray-100">{fmt(g.current_value)}</span></div>
                      <div><span className="text-gray-500 dark:text-gray-400">{t('colAvgNav')}: </span><span className="text-gray-700 dark:text-gray-300">{fmt(g.avg_cost_per_unit)}</span></div>
                      <div><span className="text-gray-500 dark:text-gray-400">{t('colCurrentNav')}: </span><span className="text-gray-700 dark:text-gray-300">{fmt(g.current_nav)}</span></div>
                      <div className="col-span-2"><span className="text-gray-500 dark:text-gray-400">{t('colGainLoss')}: </span><span className={`font-medium ${g.total_pl >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(g.total_pl)}</span></div>
                    </div>
                    {g.remaining_units > 0 && (
                      <button onClick={() => openWithdrawFund(g)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30 rounded-md transition-colors">
                        <TrendingDown className="h-3.5 w-3.5" />{t('sell')}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {/* Desktop: fund group table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-black/10 dark:border-gray-700 text-left">
                      <th className="px-4 pt-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colFund')}</th>
                      <th className="px-4 pt-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase text-right">{t('colUnits')}</th>
                      <th className="px-4 pt-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase text-right">{t('colAvgNav')}</th>
                      <th className="px-4 pt-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase text-right">{t('colCurrentNav')}</th>
                      <th className="px-4 pt-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase text-right">{t('colValue')}</th>
                      <th className="px-4 pt-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase text-right">{t('colGainLoss')}</th>
                      <th className="px-4 pt-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{tc('actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5 dark:divide-gray-700">
                    {fundGroups.map((g) => (
                      <tr key={g.fund_id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-gray-900 dark:text-gray-100">{g.fund_code}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{g.fund_name}</div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {g.remaining_units === 0
                            ? <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">{t('fullySold')}</span>
                            : <span className="font-medium text-gray-900 dark:text-gray-100">{fmtUnits(g.remaining_units)}</span>
                          }
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-gray-600 dark:text-gray-400">{fmt(g.avg_cost_per_unit)}</td>
                        <td className="px-4 py-3 text-right text-sm text-gray-600 dark:text-gray-400">{fmt(g.current_nav)}</td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-gray-100">{fmt(g.current_value)}</td>
                        <td className={`px-4 py-3 text-right font-medium ${g.total_pl >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(g.total_pl)}</td>
                        <td className="px-4 py-3">
                          {g.remaining_units > 0 && (
                            <button onClick={() => openWithdrawFund(g)} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30 rounded-md transition-colors">
                              <TrendingDown className="h-3.5 w-3.5" />{t('sell')}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

        </div>
      )}

      {/* Other Investments Tab (bank/stock/gold) */}
      {activeDetailTab === 'other' && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-black/10 dark:border-gray-700 overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-5 py-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('otherInvestments')}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('otherInvestmentsSub')}</p>
            </div>
            <button onClick={openTxAdd} className="flex items-center gap-2 h-9 px-3 sm:px-4 bg-gray-950 hover:bg-gray-800 text-white text-sm font-bold rounded-md transition-colors shrink-0 self-start sm:self-auto">
              <Plus className="h-4 w-4 shrink-0" /><span className="hidden sm:inline">{t('addTxBtn')}</span>
            </button>
          </div>

          {loading ? (
            <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">{tc('loading')}</div>
          ) : otherRows.length === 0 ? (
            <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">{t('noOtherInvestments')}</div>
          ) : (
            <>
              {/* Mobile card layout */}
              <div className="sm:hidden divide-y divide-black/5 dark:divide-gray-700">
                {otherRows.map((row) => {
                  const currentValue = getOtherCurrentValue(row)
                  const gain = currentValue - (row.amount_vnd - row.total_principal_withdrawn)
                  const remainingPrincipal = row.amount_vnd - row.total_principal_withdrawn
                  const remainingUnits = row.units != null ? row.units - row.total_units_withdrawn : null
                  const isFullyWithdrawn = row.asset_type === 'gold' ? remainingUnits !== null && remainingUnits <= 0 : remainingPrincipal <= 0
                  const rowWithdrawals = withdrawalRows.filter(w => w.parent_transaction_id === row.transaction_id)
                  return (
                    <div key={row.transaction_id} className="px-4 py-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ASSET_COLORS[row.asset_type] ?? 'bg-gray-100 text-gray-700'}`}>
                            {tt(`asset${row.asset_type.charAt(0).toUpperCase() + row.asset_type.slice(1)}` as 'assetFund' | 'assetBank' | 'assetStock' | 'assetGold') ?? row.asset_type}
                          </span>
                          {isFullyWithdrawn && <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">{t('fullyWithdrawn')}</span>}
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">{new Date(row.investment_date).toLocaleDateString('vi-VN')}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <div>
                          <span className="text-gray-500 dark:text-gray-400">{t('colAmount')}: </span>
                          <span className="font-medium text-gray-900 dark:text-gray-100">{fmt(row.amount_vnd)}</span>
                          {row.total_principal_withdrawn > 0 && (
                            <div className="text-red-500 dark:text-red-400 mt-0.5">↓ {t('withdrawnLabel')} {fmt(row.total_principal_withdrawn)}</div>
                          )}
                        </div>
                        <div><span className="text-gray-500 dark:text-gray-400">{t('remainingValueLabel')}: </span><span className="font-medium text-gray-900 dark:text-gray-100">{fmt(currentValue)}</span></div>
                        {row.asset_type === 'gold' && remainingUnits !== null && (
                          <div><span className="text-gray-500 dark:text-gray-400">{t('remainingChiLabel')}: </span><span className="text-gray-700 dark:text-gray-300">{fmtUnits(remainingUnits)}</span></div>
                        )}
                        {row.interest_rate != null && <div><span className="text-gray-500 dark:text-gray-400">{t('colInterestRate')}: </span><span className="text-gray-700 dark:text-gray-300">{row.interest_rate}%</span></div>}
                        <div><span className="text-gray-500 dark:text-gray-400">{t('colGainLoss')}: </span><span className={`font-medium ${gain >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(gain)}</span></div>
                        {row.notes && <div className="col-span-2"><span className="text-gray-500 dark:text-gray-400">{t('colNotes')}: </span><span className="text-gray-700 dark:text-gray-300">{row.notes}</span></div>}
                      </div>
                      {rowWithdrawals.length > 0 && (
                        <div className="space-y-1 border-t border-red-100 dark:border-red-900/30 pt-2">
                          {rowWithdrawals.map(w => (
                            <div key={w.transaction_id} className="flex items-center justify-between gap-2 text-xs text-red-600 dark:text-red-400">
                              <span className="min-w-0 truncate">↓ {new Date(w.investment_date).toLocaleDateString('vi-VN')}: {t('withdrawnLabel')} {fmt(w.principal_withdrawn ?? 0)}, {t('amountReceived')}: {fmt(w.amount_vnd)}</span>
                              <button onClick={() => handleWithdrawalDelete(w)} className="p-1 shrink-0 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-1 pt-0.5">
                        <button onClick={() => openTxEdit(row)} className="p-1.5 rounded-md text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"><Edit className="h-4 w-4" /></button>
                        {(row.asset_type === 'bank' || row.asset_type === 'gold') && !isFullyWithdrawn && (
                          <button onClick={() => openWithdrawOther(row)} className="flex items-center gap-1 p-1.5 rounded-md text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors">
                            <TrendingDown className="h-4 w-4" />
                          </button>
                        )}
                        <button onClick={() => handleUnassign(row)} className="p-1.5 rounded-md text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"><Unlink className="h-4 w-4" /></button>
                        <button onClick={() => handleTxDelete(row)} disabled={deletingId === row.transaction_id} className="p-1.5 rounded-md text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"><Trash2 className="h-4 w-4" /></button>
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
                      <th className="px-4 pt-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colDate')}</th>
                      <th className="px-4 pt-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colType')}</th>
                      <th className="px-4 pt-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colAmount')}</th>
                      <th className="px-4 pt-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colInterestRate')}</th>
                      <th className="px-4 pt-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colRemaining')}</th>
                      <th className="px-4 pt-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colGainLoss')}</th>
                      <th className="px-4 pt-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colNotes')}</th>
                      <th className="px-4 pt-4 pb-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{tc('actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5 dark:divide-gray-700">
                    {otherRows.map((row) => {
                      const currentValue = getOtherCurrentValue(row)
                      const remainingPrincipal = row.amount_vnd - row.total_principal_withdrawn
                      const remainingUnits = row.units != null ? row.units - row.total_units_withdrawn : null
                      const gain = currentValue - remainingPrincipal
                      const isFullyWithdrawn = row.asset_type === 'gold' ? remainingUnits !== null && remainingUnits <= 0 : remainingPrincipal <= 0
                      const rowWithdrawals = withdrawalRows.filter(w => w.parent_transaction_id === row.transaction_id)
                      return (
                        <React.Fragment key={row.transaction_id}>
                          <tr className="hover:bg-gray-50 dark:hover:bg-gray-800">
                            <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{new Date(row.investment_date).toLocaleDateString('vi-VN')}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${ASSET_COLORS[row.asset_type] ?? 'bg-gray-100 text-gray-700'}`}>
                                {tt(`asset${row.asset_type.charAt(0).toUpperCase() + row.asset_type.slice(1)}` as 'assetFund' | 'assetBank' | 'assetStock' | 'assetGold') ?? row.asset_type}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-medium text-gray-900 dark:text-gray-100">{fmt(row.amount_vnd)}</div>
                              {row.total_principal_withdrawn > 0 && (
                                <div className="text-xs text-red-500 dark:text-red-400 mt-0.5">↓ {t('withdrawnLabel')} {fmt(row.total_principal_withdrawn)}</div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{row.interest_rate != null ? `${row.interest_rate}%` : '—'}</td>
                            <td className="px-4 py-3 text-sm">
                              {isFullyWithdrawn
                                ? <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400">Đã rút hết</span>
                                : row.asset_type === 'gold' && remainingUnits != null
                                  ? <span className="text-gray-700 dark:text-gray-300">{fmtUnits(remainingUnits)} chi · {fmt(currentValue)}</span>
                                  : <span className="text-gray-700 dark:text-gray-300">{fmt(currentValue)}</span>
                              }
                            </td>
                            <td className={`px-4 py-3 font-medium ${gain >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(gain)}</td>
                            <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-500 max-w-32 truncate">{row.notes ?? '—'}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1">
                                <button onClick={() => openTxEdit(row)} className="p-1.5 rounded-md text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"><Edit className="h-4 w-4" /></button>
                                {(row.asset_type === 'bank' || row.asset_type === 'gold') && !isFullyWithdrawn && (
                                  <button onClick={() => openWithdrawOther(row)} title={row.asset_type === 'gold' ? t('sell') : t('withdraw')} className="p-1.5 rounded-md text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors">
                                    <TrendingDown className="h-4 w-4" />
                                  </button>
                                )}
                                <button onClick={() => handleUnassign(row)} className="p-1.5 rounded-md text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"><Unlink className="h-4 w-4" /></button>
                                <button onClick={() => handleTxDelete(row)} disabled={deletingId === row.transaction_id} className="p-1.5 rounded-md text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"><Trash2 className="h-4 w-4" /></button>
                              </div>
                            </td>
                          </tr>
                          {rowWithdrawals.map(w => (
                            <tr key={w.transaction_id} className="bg-red-50/40 dark:bg-red-900/10">
                              <td className="pl-8 pr-4 py-2 text-xs text-gray-400 dark:text-gray-500">{new Date(w.investment_date).toLocaleDateString('vi-VN')}</td>
                              <td colSpan={6} className="px-4 py-2 text-xs text-red-600 dark:text-red-400">
                                ↓ {t('withdrawnLabel')} {fmt(w.principal_withdrawn ?? 0)} · {t('amountReceived')}: {fmt(w.amount_vnd)}{w.notes ? ` · ${w.notes}` : ''}
                              </td>
                              <td className="px-4 py-2">
                                <button onClick={() => handleWithdrawalDelete(w)} className="p-1 rounded-md text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Edit Goal Modal */}
      {showEditGoal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={(e) => { e.preventDefault(); handleEditGoalSave() }} className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-6 border border-gray-100 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{t('editModal')}</h3>
            {editGoalError && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{editGoalError}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('nameLabel')}</label>
                <input type="text" value={editGoalName} onChange={(e) => setEditGoalName(e.target.value)} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('targetLabel')}</label>
                <input type="number" value={editGoalTarget} onChange={(e) => setEditGoalTarget(e.target.value)} placeholder={t('targetOptional')} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('descLabel')}</label>
                <textarea value={editGoalDesc} onChange={(e) => setEditGoalDesc(e.target.value)} rows={3} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button type="button" onClick={() => setShowEditGoal(false)} className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">{tc('cancel')}</button>
              <button type="submit" disabled={editGoalSaving} className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">{editGoalSaving ? tc('saving') : tc('save')}</button>
            </div>
          </form>
        </div>
      )}

      {/* Fund Investment Add/Edit Modal */}
      {(formMode === 'fi-add' || formMode === 'fi-edit') && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-6 border border-gray-100 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{formMode === 'fi-edit' ? t('editModal') : t('fundInvestments')}</h3>
            {formError && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{formError}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('fundLabel')}</label>
                <select value={fiForm.fund_id} onChange={(e) => setFiForm({ ...fiForm, fund_id: e.target.value })} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">{t('selectFund')}</option>
                  {funds.map((f) => <option key={f.id} value={f.id}>{f.code} - {f.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('investmentDateLabel')}</label>
                <input type="date" value={fiForm.investment_date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setFiForm({ ...fiForm, investment_date: e.target.value })} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('amountVndLabel')}</label>
                <input type="number" value={fiForm.amount_vnd} onChange={(e) => setFiForm({ ...fiForm, amount_vnd: e.target.value })} placeholder="VD: 10000000" className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('fiUnitsLabel')}</label>
                  <input type="number" value={fiForm.units} onChange={(e) => setFiForm({ ...fiForm, units: e.target.value })} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('navAtBuyLabel')}</label>
                  <input type="number" value={fiForm.unit_price} onChange={(e) => setFiForm({ ...fiForm, unit_price: e.target.value })} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setFormMode(null)} className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">{tc('cancel')}</button>
              <button onClick={handleFiSave} disabled={saving} className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">{saving ? tc('saving') : tc('save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Other Transaction Add/Edit Modal */}
      {(formMode === 'tx-add' || formMode === 'tx-edit') && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto border border-gray-100 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{formMode === 'tx-edit' ? t('editTxModal') : t('otherInvestments')}</h3>
            {formError && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{formError}</p>}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('assetTypeLabel')}</label>
                  <select value={txForm.asset_type} onChange={(e) => setTxForm({ ...txForm, asset_type: e.target.value, fund_id: '' })} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    {[{ v: 'bank', l: t('assetBank') }, { v: 'stock', l: t('assetStock') }, { v: 'gold', l: t('assetGold') }].map((item) => <option key={item.v} value={item.v}>{item.l}</option>)}
                  </select>
                </div>
                <div className="min-w-0">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('investmentDateLabel')}</label>
                  <input type="date" value={txForm.investment_date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setTxForm({ ...txForm, investment_date: e.target.value })} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('amountVndLabel')}</label>
                <input type="number" value={txForm.amount_vnd} onChange={(e) => setTxForm({ ...txForm, amount_vnd: e.target.value })} placeholder="VD: 10000000" className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('unitPriceLabel')}</label>
                  <input type="number" value={txForm.unit_price} onChange={(e) => setTxForm({ ...txForm, unit_price: e.target.value })} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{txForm.asset_type === 'stock' ? t('unitsStockLabel') : txForm.asset_type === 'gold' ? t('unitsGoldLabel') : t('unitsDefaultLabel')}</label>
                  <input type="number" value={txForm.units} onChange={(e) => setTxForm({ ...txForm, units: e.target.value })} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('interestRateLabel')}</label>
                <input type="number" step="0.1" value={txForm.interest_rate} onChange={(e) => setTxForm({ ...txForm, interest_rate: e.target.value })} placeholder="VD: 5.5" className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              {txForm.asset_type === 'bank' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('expiryDateLabel')}</label>
                  <input type="date" value={txForm.expiry_date} onChange={(e) => setTxForm({ ...txForm, expiry_date: e.target.value })} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{tc('notes')}</label>
                <textarea value={txForm.notes} onChange={(e) => setTxForm({ ...txForm, notes: e.target.value })} rows={2} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setFormMode(null)} className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">{tc('cancel')}</button>
              <button onClick={handleTxSave} disabled={saving} className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">{saving ? tc('saving') : tc('save')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Withdraw / Sell Modal */}
      <Dialog open={formMode === 'withdraw' && !!withdrawSource} onOpenChange={(open) => { if (!open) { setFormMode(null); setWithdrawSource(null) } }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{withdrawModalTitle}</DialogTitle>
          </DialogHeader>

          {/* Context info */}
          <div className="text-sm text-gray-500 dark:text-gray-400 -mt-2">
            {wType === 'fund' && wGroup && (
              <span>{wGroup.fund_code} · {t('colCurrentNav')}: <strong className="text-gray-800 dark:text-gray-200">{fmt(wGroup.current_nav)}</strong> · {t('colRemaining')}: <strong className="text-gray-800 dark:text-gray-200">{fmtUnits(wGroup.remaining_units)} {t('unitsShort')}</strong></span>
            )}
            {wType === 'gold' && wRow && goldPrice && (
              <span>{t('assetGold')} · {t('currentPriceLabel')}: <strong className="text-gray-800 dark:text-gray-200">{fmt(goldPrice)}/chi</strong> · {t('colRemaining')}: <strong className="text-gray-800 dark:text-gray-200">{fmtUnits((wRow.units ?? 0) - wRow.total_units_withdrawn)} chi</strong></span>
            )}
            {wType === 'bank' && wRow && (
              <span>{t('assetBank')} · {t('remainingPrincipalLabel')}: <strong className="text-gray-800 dark:text-gray-200">{fmt(wRow.amount_vnd - wRow.total_principal_withdrawn)}</strong>{wRow.interest_rate ? ` · ${wRow.interest_rate}${t('perYearShort')}` : ''}</span>
            )}
          </div>

          {formError && <p className="text-red-600 dark:text-red-400 text-sm">{formError}</p>}

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{wType === 'bank' ? t('dateWithdrawLabel') : t('dateSellLabel')}</label>
              <input type="date" value={withdrawForm.investment_date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setWithdrawForm({ ...withdrawForm, investment_date: e.target.value })} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>

            {wType === 'bank' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('principalWithdrawnLabel')}</label>
                  <input type="number" value={withdrawForm.principal_withdrawn} onChange={(e) => setWithdrawForm({ ...withdrawForm, principal_withdrawn: e.target.value })} placeholder={t('principalWithdrawnPlaceholder')} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('amountReceivedLabel')}</label>
                  <input type="number" value={withdrawForm.amount_vnd} onChange={(e) => setWithdrawForm({ ...withdrawForm, amount_vnd: e.target.value })} placeholder={t('amountReceivedPlaceholder')} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              </>
            )}

            {(wType === 'fund' || wType === 'gold') && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{wType === 'gold' ? t('unitsToSellGold') : t('unitsToSellFund')}</label>
                  <input
                    type="number"
                    value={withdrawForm.units_withdrawn}
                    onChange={(e) => {
                      const u = e.target.value
                      const uNum = Number(u) || 0
                      const price = wType === 'fund' ? (wGroup?.current_nav ?? 0) : (goldPrice ?? 0)
                      setWithdrawForm({ ...withdrawForm, units_withdrawn: u, amount_vnd: uNum > 0 && price > 0 ? String(Math.round(uNum * price)) : withdrawForm.amount_vnd })
                    }}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('amountReceivedLabel')}</label>
                  <input
                    type="number"
                    value={withdrawForm.amount_vnd}
                    onChange={(e) => {
                      const a = e.target.value
                      const aNum = Number(a) || 0
                      const price = wType === 'fund' ? (wGroup?.current_nav ?? 0) : (goldPrice ?? 0)
                      setWithdrawForm({ ...withdrawForm, amount_vnd: a, units_withdrawn: aNum > 0 && price > 0 ? String(+(aNum / price).toFixed(4)) : withdrawForm.units_withdrawn })
                    }}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{tc('notes')}</label>
              <input type="text" value={withdrawForm.notes} onChange={(e) => setWithdrawForm({ ...withdrawForm, notes: e.target.value })} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-base bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
          </div>

          {/* Live preview */}
          {(wAmtNum > 0 || wUnitsNum > 0) && (
            <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-1 text-xs">
              {wPrinNum > 0 && <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">{t('costBasisLabel')}:</span><span className="font-medium text-gray-700 dark:text-gray-300">{fmt(wPrinNum)}</span></div>}
              {wAmtNum > 0 && <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">{t('receivedLabel')}:</span><span className="font-medium text-gray-700 dark:text-gray-300">{fmt(wAmtNum)}</span></div>}
              <div className="flex justify-between border-t border-gray-200 dark:border-gray-700 pt-1 mt-1">
                <span className="text-gray-500 dark:text-gray-400">{t('colGainLoss')}:</span>
                <span className={`font-semibold ${wGain >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmt(wGain)}</span>
              </div>
              {wRemainingUnits !== null && wUnitsNum > 0 && (
                <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">{t('colRemaining')}:</span><span className="font-medium text-gray-700 dark:text-gray-300">{fmtUnits(Math.max(0, wRemainingUnits))} {wType === 'gold' ? 'chi' : t('unitsShort')}</span></div>
              )}
              {wRemainingPrincipal !== null && Number(withdrawForm.principal_withdrawn) > 0 && (
                <div className="flex justify-between"><span className="text-gray-500 dark:text-gray-400">{t('remainingPrincipalLabel')}:</span><span className="font-medium text-gray-700 dark:text-gray-300">{fmt(Math.max(0, wRemainingPrincipal))}</span></div>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => { setFormMode(null); setWithdrawSource(null) }} className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">{tc('cancel')}</button>
            <button onClick={handleWithdrawSave} disabled={saving} className="flex-1 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50">{saving ? tc('saving') : (wType === 'bank' ? t('withdraw') : t('sell'))}</button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={!!pendingConfirm}
        title={pendingConfirm?.title ?? ''}
        message={pendingConfirm?.message ?? ''}
        confirming={confirming}
        onConfirm={async () => {
          if (!pendingConfirm) return
          setConfirming(true)
          await pendingConfirm.onConfirm()
          setConfirming(false)
          setPendingConfirm(null)
        }}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  )
}
