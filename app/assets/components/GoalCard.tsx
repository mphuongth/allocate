import type { FundBreakdownItem } from '../DashboardClient'

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
  funds: FundBreakdownItem[]
  isExpanded: boolean
  onToggleExpand: (goalId: string) => void
  onFundClick: (fundId: string) => void
}

export default function GoalCard({
  goalId, goalName, targetAmount, currentValue, totalInvested,
  profitLoss, profitLossPercentage, progressPercentage, funds,
  isExpanded, onToggleExpand, onFundClick,
}: Props) {
  const plPositive = profitLoss >= 0
  const exceededTarget = progressPercentage !== null && progressPercentage >= 100

  return (
    <div
      className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden cursor-pointer hover:border-gray-200 transition-colors"
      onClick={() => onToggleExpand(goalId)}
    >
      <div className="p-5">
        <div className="flex items-start justify-between mb-2">
          <h3 className="font-semibold text-gray-900 text-sm">{goalName}</h3>
          <span className="text-gray-400 text-sm ml-2">{isExpanded ? '▲' : '▼'}</span>
        </div>

        <p className="text-2xl font-bold text-gray-900 mb-1">{fmt(currentValue)}</p>

        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-gray-400">P&amp;L</span>
          <span className={`text-xs font-medium ${plPositive ? 'text-green-600' : 'text-red-600'}`}>
            {fmt(profitLoss)} ({fmtPct(profitLossPercentage)})
          </span>
        </div>

        {targetAmount != null && (
          <div>
            <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
              <span>Target: {fmt(targetAmount)}</span>
              {exceededTarget
                ? <span className="text-green-600 font-medium">Target exceeded</span>
                : <span>{Math.round(progressPercentage ?? 0)}%</span>
              }
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${exceededTarget ? 'bg-green-500' : 'bg-indigo-500'}`}
                style={{ width: `${Math.min(progressPercentage ?? 0, 100)}%` }}
              />
            </div>
          </div>
        )}

        {targetAmount == null && currentValue === 0 && (
          <p className="text-xs text-gray-400">₫0</p>
        )}
      </div>

      {/* Expanded fund breakdown */}
      {isExpanded && funds.length > 0 && (
        <div className="border-t border-gray-100 bg-gray-50">
          {funds.map((fund) => (
            <button
              key={fund.fundId}
              onClick={(e) => { e.stopPropagation(); onFundClick(fund.fundId) }}
              className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-100 text-left border-b border-gray-100 last:border-0"
            >
              <span className="text-sm font-medium text-gray-700">{fund.fundName}</span>
              <div className="text-right">
                <p className="text-sm text-gray-900">{fmt(fund.currentValue)}</p>
                <p className={`text-xs ${fund.profitLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {fmtPct(fund.profitLossPercentage)}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {isExpanded && funds.length === 0 && (
        <div className="border-t border-gray-100 px-5 py-3 text-xs text-gray-400 bg-gray-50">
          No fund investments in this goal
        </div>
      )}
    </div>
  )
}
