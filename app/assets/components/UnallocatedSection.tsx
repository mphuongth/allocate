import type { FundBreakdownItem } from '../DashboardClient'

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

interface Props {
  unallocatedAmount: number
  funds: FundBreakdownItem[]
  onFundClick: (fundId: string) => void
  onAssignToGoal: (fundId: string) => void
}

export default function UnallocatedSection({ unallocatedAmount, funds, onFundClick, onAssignToGoal }: Props) {
  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Unallocated Investments</h2>
        <span className="text-sm text-gray-500 dark:text-gray-400">Total: {fmt(unallocatedAmount)}</span>
      </div>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {funds.map((fund) => (
          <div
            key={fund.fundId}
            className="flex items-center justify-between px-5 py-4 border-b border-gray-50 dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <button
              onClick={() => onFundClick(fund.fundId)}
              className="flex-1 text-left"
            >
              <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">{fund.fundName}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {fund.quantity} units · NAV {fmt(fund.currentNAV)}
              </p>
            </button>
            <div className="flex items-center gap-4 ml-4">
              <div className="text-right">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{fmt(fund.currentValue)}</p>
                <p className={`text-xs ${fund.profitLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {fmtPct(fund.profitLossPercentage)}
                </p>
              </div>
              <button
                onClick={() => onAssignToGoal(fund.fundId)}
                className="text-xs px-2 py-1 border border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 rounded-md hover:bg-indigo-50 dark:hover:bg-indigo-900/20 whitespace-nowrap"
              >
                Assign to Goal
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
