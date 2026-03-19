const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

interface Props {
  totalAssets: number
  totalLiabilities: number
  netWorth: number
  totalInvested: number
  currentValue: number
  overallProfitLoss: number
  overallProfitLossPercentage: number
  navStale: boolean
}

export default function NetWorthCard({
  totalAssets, totalLiabilities, netWorth, totalInvested, currentValue,
  overallProfitLoss, overallProfitLossPercentage, navStale,
}: Props) {
  const plPositive = overallProfitLoss >= 0

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
      <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Net Worth</p>
      <p className="text-4xl font-bold text-gray-900 dark:text-gray-100 mb-6">{fmt(netWorth)}</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 border-t border-gray-100 dark:border-gray-700 pt-5">
        <div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">Total Assets</p>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{fmt(totalAssets)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">Total Liabilities</p>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{fmt(totalLiabilities)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">
            Portfolio Value
            {navStale && <span title="NAV data may be stale" className="ml-1 text-amber-500">⚠️</span>}
          </p>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{fmt(currentValue)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">Total Invested</p>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{fmt(totalInvested)}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <span className="text-xs text-gray-400 dark:text-gray-500">Overall P&amp;L</span>
        <span className={`text-sm font-semibold ${plPositive ? 'text-green-600' : 'text-red-600'}`}>
          {fmt(overallProfitLoss)} ({fmtPct(overallProfitLossPercentage)})
        </span>
      </div>
    </div>
  )
}
