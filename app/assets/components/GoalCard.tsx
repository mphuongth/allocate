'use client'

import { useRouter } from 'next/navigation'

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

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
  const router = useRouter()
  const plPositive = profitLoss >= 0
  const exceededTarget = progressPercentage !== null && progressPercentage >= 100

  return (
    <div
      className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden cursor-pointer hover:border-indigo-200 dark:hover:border-indigo-700 hover:shadow-md transition-all"
      onClick={() => router.push(`/settings?tab=goals&goal=${goalId}`)}
    >
      <div className="p-5">
        <div className="flex items-start justify-between mb-2">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">{goalName}</h3>
          <span className="text-gray-300 dark:text-gray-600 text-sm ml-2">→</span>
        </div>

        <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">{fmt(currentValue)}</p>

        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-gray-400 dark:text-gray-500">P&amp;L</span>
          <span className={`text-xs font-medium ${plPositive ? 'text-green-600' : 'text-red-600'}`}>
            {fmt(profitLoss)} ({fmtPct(profitLossPercentage)})
          </span>
        </div>

        {targetAmount != null && (
          <div>
            <div className="flex items-center justify-between text-xs text-gray-400 dark:text-gray-500 mb-1">
              <span>Target: {fmt(targetAmount)}</span>
              {exceededTarget
                ? <span className="text-green-600 font-medium">Target exceeded</span>
                : <span>{Math.round(progressPercentage ?? 0)}%</span>
              }
            </div>
            <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${exceededTarget ? 'bg-green-500' : 'bg-indigo-500'}`}
                style={{ width: `${Math.min(progressPercentage ?? 0, 100)}%` }}
              />
            </div>
          </div>
        )}

        {targetAmount == null && currentValue === 0 && (
          <p className="text-xs text-gray-400 dark:text-gray-500">No transactions yet</p>
        )}
      </div>
    </div>
  )
}
