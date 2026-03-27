'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import GoalDetailView from './GoalDetailView'
import ConfirmModal from '@/app/components/ConfirmModal'

interface SavingsGoal {
  goal_id: string
  goal_name: string
  description: string | null
  target_amount: number | null
  created_at: string
}

interface GoalWithStats extends SavingsGoal {
  transactionCount: number
  totalInvested: number
  projectedInterest: number
}

interface Props {
  initialGoalId?: string
  onGoalChange?: (id: string | null) => void
}

const GOALS_CACHE_KEY = 'savingsGoalsCache'
const CACHE_TTL = 2 * 60 * 1000
function getGoalsCache(): GoalWithStats[] | null {
  try {
    const raw = localStorage.getItem(GOALS_CACHE_KEY)
    if (!raw) return null
    const { data, ts } = JSON.parse(raw)
    if (Date.now() - ts > CACHE_TTL) return null
    return data
  } catch { return null }
}
function setGoalsCache(data: GoalWithStats[]) {
  try { localStorage.setItem(GOALS_CACHE_KEY, JSON.stringify({ data, ts: Date.now() })) } catch {}
}
function bustGoalsCache() {
  try { localStorage.removeItem(GOALS_CACHE_KEY) } catch {}
}

export default function SavingsGoalsTab({ initialGoalId, onGoalChange }: Props) {
  const [goals, setGoals] = useState<GoalWithStats[]>(() => getGoalsCache() ?? [])
  const [loading, setLoading] = useState(() => !getGoalsCache())
  const [selectedGoal, setSelectedGoal] = useState<SavingsGoal | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editGoal, setEditGoal] = useState<SavingsGoal | null>(null)
  const [formName, setFormName] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formTargetAmount, setFormTargetAmount] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [confirmGoal, setConfirmGoal] = useState<GoalWithStats | null>(null)
  const [deletingGoal, setDeletingGoal] = useState(false)
  const hasAutoSelected = useRef(false)

  const fetchGoals = useCallback(async (opts?: { force?: boolean }) => {
    if (opts?.force) bustGoalsCache()
    const res = await fetch('/api/v1/savings-goals?stats=true')
    const { goals: fetched } = await res.json()
    const list: GoalWithStats[] = fetched ?? []
    setGoalsCache(list)
    setGoals(list)
    if (initialGoalId && !hasAutoSelected.current) {
      const match = list.find((g: GoalWithStats) => g.goal_id === initialGoalId)
      if (match) { setSelectedGoal(match); hasAutoSelected.current = true }
    }
    setLoading(false)
  }, [initialGoalId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchGoals() }, [fetchGoals])

  function selectGoal(goal: SavingsGoal) {
    setSelectedGoal(goal)
    onGoalChange?.(goal.goal_id)
  }

  function clearGoal() {
    setSelectedGoal(null)
    onGoalChange?.(null)
    fetchGoals({ force: true })
  }

  function openCreate() {
    setEditGoal(null)
    setFormName('')
    setFormDesc('')
    setFormTargetAmount('')
    setFormError('')
    setShowForm(true)
  }

  function openEdit(goal: SavingsGoal) {
    setEditGoal(goal)
    setFormName(goal.goal_name)
    setFormDesc(goal.description ?? '')
    setFormTargetAmount(goal.target_amount != null ? String(goal.target_amount) : '')
    setFormError('')
    setShowForm(true)
  }

  async function handleSave() {
    if (!formName.trim()) { setFormError('Tên mục tiêu là bắt buộc.'); return }
    setSaving(true)
    setFormError('')
    const url = editGoal ? `/api/v1/savings-goals/${editGoal.goal_id}` : '/api/v1/savings-goals'
    const method = editGoal ? 'PUT' : 'POST'
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal_name: formName, description: formDesc, target_amount: formTargetAmount || null }),
    })
    if (!res.ok) {
      const { error } = await res.json()
      setFormError(error ?? 'Đã xảy ra lỗi.')
    } else {
      setShowForm(false)
      await fetchGoals({ force: true })
    }
    setSaving(false)
  }

  async function handleDelete(goal: GoalWithStats) {
    setDeletingGoal(true)
    const res = await fetch(`/api/v1/savings-goals/${goal.goal_id}`, { method: 'DELETE' })
    if (res.ok) {
      setConfirmGoal(null)
      const { message } = await res.json()
      setSuccessMsg(message)
      setTimeout(() => setSuccessMsg(''), 5000)
      await fetchGoals({ force: true })
    }
    setDeletingGoal(false)
  }

  const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')

  if (selectedGoal) {
    return (
      <GoalDetailView
        goal={selectedGoal}
        onBack={clearGoal}
      />
    )
  }

  return (
    <div>
      {successMsg && (
        <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-300 rounded-lg text-sm">{successMsg}</div>
      )}

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Mục tiêu Tiết kiệm</h2>
        <button onClick={openCreate} className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors">
          Tạo Mục tiêu
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500 text-sm">Đang tải...</div>
      ) : goals.length === 0 ? (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">
          <p className="text-lg mb-2">Chưa có mục tiêu tiết kiệm</p>
          <p className="text-sm">Tạo mục tiêu để bắt đầu theo dõi đầu tư.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {goals.map((goal) => (
            <div key={goal.goal_id} className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 hover:shadow-md transition-shadow">
              <div className="mb-3">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-base">{goal.goal_name}</h3>
                {goal.target_amount != null && (
                  <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-0.5">Mục tiêu: {fmt(goal.target_amount)}</p>
                )}
                {goal.description && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{goal.description}</p>}
              </div>

              <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-3 mb-3">
                <p className="text-xs text-indigo-600 dark:text-indigo-400 font-medium mb-1">Giá trị Hiện tại</p>
                <p className="text-xl font-bold text-indigo-700 dark:text-indigo-300">{fmt(goal.totalInvested + goal.projectedInterest)}</p>
                <div className="flex gap-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
                  <span>Đã đầu tư: {fmt(goal.totalInvested)}</span>
                  <span>Lãi: {fmt(goal.projectedInterest)}</span>
                </div>
              </div>

              <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
                {new Date(goal.created_at).toLocaleDateString('vi-VN')} · {goal.transactionCount} giao dịch
              </p>

              <div className="flex gap-2">
                <button
                  onClick={() => selectGoal(goal)}
                  className="flex-1 py-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-700 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                >
                  Xem Chi tiết
                </button>
                <button
                  onClick={() => openEdit(goal)}
                  className="px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Sửa
                </button>
                <button
                  onClick={() => setConfirmGoal(goal)}
                  className="px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  Xóa
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={(e) => { e.preventDefault(); handleSave() }} className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-6 border border-gray-100 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{editGoal ? 'Sửa Mục tiêu' : 'Tạo Mục tiêu'}</h3>
            {formError && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{formError}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tên Mục tiêu *</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="VD: Hưu trí"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Số tiền Mục tiêu (VND)</label>
                <input
                  type="number"
                  value={formTargetAmount}
                  onChange={(e) => setFormTargetAmount(e.target.value)}
                  placeholder="Tùy chọn — VD: 50000000"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mô tả</label>
                <textarea
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  rows={3}
                  placeholder="Mô tả tùy chọn"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Hủy</button>
              <button type="submit" disabled={saving} className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Đang lưu...' : 'Lưu'}
              </button>
            </div>
          </form>
        </div>
      )}

      {confirmGoal && (
        <ConfirmModal
          title="Xóa Mục tiêu"
          message={`${confirmGoal.transactionCount} giao dịch trong mục tiêu này sẽ bị bỏ gán.`}
          detail={`"${confirmGoal.goal_name}"`}
          confirming={deletingGoal}
          onConfirm={() => handleDelete(confirmGoal)}
          onCancel={() => setConfirmGoal(null)}
        />
      )}
    </div>
  )
}
