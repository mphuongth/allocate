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

  return (
    <div
      className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden cursor-pointer hover:border-violet-200 dark:hover:border-violet-700 hover:shadow-md transition-all"
      onClick={() => router.push(`/settings?tab=goals&goal=${goalId}`)}
    >
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div
              className="h-10 w-10 rounded-lg flex items-center justify-center text-white font-semibold text-sm flex-shrink-0"
              style={{ backgroundColor: color }}
            >
              {goalName.charAt(0).toUpperCase()}
            </div>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm leading-tight">{goalName}</h3>
          </div>
          <span className="text-gray-300 dark:text-gray-600 text-sm ml-2 flex-shrink-0">→</span>
        </div>

        <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">{fmt(currentValue)}</p>

        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-gray-400 dark:text-gray-500">{t('gainLoss')}</span>
          <span className={`text-xs font-medium ${plPositive ? 'text-green-600' : 'text-red-600'}`}>
            {fmt(profitLoss)} ({fmtPct(profitLossPercentage)})
          </span>
        </div>

        {targetAmount != null && (
          <div>
            <div className="flex items-center justify-between text-xs text-gray-400 dark:text-gray-500 mb-1">
              <span>{t('goalTarget2', { amount: fmt(targetAmount) })}</span>
              {exceededTarget
                ? <span className="text-green-600 font-medium">{t('exceededTarget')}</span>
                : <span>{Math.round(progressPercentage ?? 0)}%</span>
              }
            </div>
            <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(progressPercentage ?? 0, 100)}%`,
                  backgroundColor: exceededTarget ? '#22c55e' : color,
                }}
              />
            </div>
          </div>
        )}

        {targetAmount == null && currentValue === 0 && (
          <p className="text-xs text-gray-400 dark:text-gray-500">{t('noTransactions')}</p>
        )}
      </div>
    </div>
  )
}
