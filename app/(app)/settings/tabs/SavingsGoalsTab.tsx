'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Plus, Edit, Trash2, TrendingUp } from 'lucide-react'
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
  const t = useTranslations('goals')
  const tCommon = useTranslations('common')
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
    if (!formName.trim()) { setFormError(t('nameRequired')); return }
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
      setFormError(error ?? tCommon('error'))
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
    <div className="space-y-6">
      {successMsg && (
        <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-300 rounded-lg text-sm">{successMsg}</div>
      )}

      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('title')}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('desc')}</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 h-9 px-4 py-2 bg-gray-950 hover:bg-gray-800 text-white text-sm font-semibold rounded-md transition-colors">
          <Plus className="h-4 w-4" />
          {t('create')}
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500 text-sm">{tCommon('loading')}</div>
      ) : goals.length === 0 ? (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">
          <p className="text-lg mb-2">{t('empty')}</p>
          <p className="text-sm">{t('emptyDesc')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {goals.map((goal) => (
            <div key={goal.goal_id} onClick={() => selectGoal(goal)} className="bg-white dark:bg-gray-900 rounded-xl border-2 border-black/10 dark:border-gray-700 p-5 hover:shadow-lg hover:border-violet-200 dark:hover:border-violet-700 transition-all cursor-pointer">
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-lg mb-1">{goal.goal_name}</h3>
                  {goal.target_amount != null && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">{t('progress')}: {fmt(goal.target_amount)}</p>
                  )}
                </div>
                <div className="flex gap-1 ml-2 shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); openEdit(goal) }}
                    className="p-1.5 rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmGoal(goal) }}
                    className="p-1.5 rounded-md text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {/* Current value */}
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <p className="text-xs text-blue-700 dark:text-blue-400 font-medium uppercase mb-1">{t('currentValue')}</p>
                  <p className="text-2xl font-bold text-blue-900 dark:text-blue-200">{fmt(goal.totalInvested + goal.projectedInterest)}</p>
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('totalInvested')}</p>
                    <p className="font-medium text-gray-900 dark:text-gray-100">{fmt(goal.totalInvested)}</p>
                  </div>
                  <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('interest')}</p>
                    <p className={`font-medium ${goal.projectedInterest >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {fmt(goal.projectedInterest)}
                    </p>
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between pt-2 border-t border-black/10 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400">
                  <span>{t('transactions', { count: goal.transactionCount })}</span>
                  <span>{new Date(goal.created_at).toLocaleDateString('vi-VN')}</span>
                </div>
              </div>

            </div>
          ))}
        </div>
      )}

      {/* Summary Card */}
      {goals.length > 0 && (
        <div className="p-6 rounded-xl border border-violet-200 dark:border-violet-800 bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-900/20 dark:to-purple-900/20">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-violet-900 dark:text-violet-300 mb-2">{t('totalAcrossGoals')}</h3>
              <div className="flex items-baseline gap-6">
                <div>
                  <p className="text-xs text-violet-700 dark:text-violet-400">{t('currentValue')}</p>
                  <p className="text-3xl font-bold text-violet-900 dark:text-violet-200">
                    {fmt(goals.reduce((sum, g) => sum + g.totalInvested + g.projectedInterest, 0))}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-violet-700 dark:text-violet-400">{t('interest')}</p>
                  <p className="text-xl font-semibold text-green-600 dark:text-green-400">
                    +{fmt(goals.reduce((sum, g) => sum + g.projectedInterest, 0))}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-violet-500 text-white shrink-0">
              <TrendingUp className="h-8 w-8" />
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={(e) => { e.preventDefault(); handleSave() }} className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-6 border border-gray-100 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{editGoal ? t('editModal') : t('createModal')}</h3>
            {formError && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{formError}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('nameLabel')}</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder={t('namePlaceholder')}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('targetLabel')}</label>
                <input
                  type="number"
                  value={formTargetAmount}
                  onChange={(e) => setFormTargetAmount(e.target.value)}
                  placeholder={t('targetPlaceholder')}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('descLabel')}</label>
                <textarea
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  rows={3}
                  placeholder={t('descPlaceholder')}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">{tCommon('cancel')}</button>
              <button type="submit" disabled={saving} className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {saving ? tCommon('saving') : tCommon('save')}
              </button>
            </div>
          </form>
        </div>
      )}

      {confirmGoal && (
        <ConfirmModal
          title={t('deleteModal')}
          message={t('deleteMessage', { count: confirmGoal.transactionCount })}
          detail={`"${confirmGoal.goal_name}"`}
          confirming={deletingGoal}
          onConfirm={() => handleDelete(confirmGoal)}
          onCancel={() => setConfirmGoal(null)}
        />
      )}
    </div>
  )
}
