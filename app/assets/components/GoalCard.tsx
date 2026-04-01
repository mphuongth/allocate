'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

const GOAL_COLORS = [
  '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444',
  '#3b82f6', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
]

function goalColor(goalId: string): string {
  let hash = 0
  for (let i = 0; i < goalId.length; i++) {
    hash = (hash * 31 + goalId.charCodeAt(i)) & 0xffffffff
  }
  return GOAL_COLORS[Math.abs(hash) % GOAL_COLORS.length]
}

interface Props {
  goalId: string
  goalName: string
  targetAmount: number | null
  currentValue: number
  totalInvested: number
  profitLoss: number
  profitLossPercentage: number
  progressPercentage: number | null
}

export default function GoalCard({
  goalId, goalName, targetAmount, currentValue, totalInvested,
  profitLoss, profitLossPercentage, progressPercentage,
}: Props) {
  const t = useTranslations('dashboard')
  const router = useRouter()
  const plPositive = profitLoss >= 0
  const exceededTarget = progressPercentage !== null && progressPercentage >= 100
  const color = goalColor(goalId)
  const progress = Math.min(progressPercentage ?? 0, 100)

  return (
    <div
      className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 cursor-pointer hover:shadow-md transition-shadow"
      onClick={() => router.push(`/settings?tab=goals&goal=${goalId}`)}
    >
      {/* Icon + name + target */}
      <div className="flex items-start gap-3 mb-3">
        <div
          className="h-10 w-10 rounded-lg flex items-center justify-center text-white font-semibold flex-shrink-0"
          style={{ backgroundColor: color }}
        >
          {goalName.charAt(0).toUpperCase()}
        </div>
        <div>
          <h4 className="font-medium text-gray-900 dark:text-gray-100">{goalName}</h4>
          {targetAmount != null && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t('goalTarget', { amount: fmt(targetAmount) })}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {/* Value + % */}
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">{fmt(currentValue)}</span>
          <span className={`text-sm font-medium ${plPositive ? 'text-green-600' : 'text-red-600'}`}>
            {fmtPct(profitLossPercentage)}
          </span>
        </div>

        {/* Progress bar */}
        {targetAmount != null && (
          <>
            <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${progress}%`, backgroundColor: exceededTarget ? '#22c55e' : color }}
              />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {exceededTarget ? t('exceededTarget') : t('goalProgress', { pct: Math.round(progress) })}
            </p>
          </>
        )}

        {/* Gain/Loss */}
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t('gainLoss')}: <span className={plPositive ? 'text-green-600' : 'text-red-600'}>{fmt(profitLoss)}</span>
        </p>
      </div>
    </div>
  )
}
