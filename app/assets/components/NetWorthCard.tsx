'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')
const fmtShort = (n: number) => {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(0) + 'M'
  return n.toLocaleString('vi-VN')
}
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

const TIME_RANGES = ['6m', '1y', '3y', 'All'] as const
type TimeRange = typeof TIME_RANGES[number]

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
  const t = useTranslations('dashboard')
  const plPositive = overallProfitLoss >= 0
  const [timeRange, setTimeRange] = useState<TimeRange>('6m')

  // Placeholder chart data — single current point. Real history requires backend support.
  const chartData = [{ label: t('now'), value: netWorth }]

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 h-full flex flex-col">
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400 uppercase mb-1">
            {t('totalAssets')}
          </p>
          <p className="text-4xl font-bold text-gray-900 dark:text-gray-100">{fmt(totalAssets)}</p>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-3">
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">{t('gainLossAll')}</p>
              <p className={`text-sm font-semibold ${plPositive ? 'text-green-600' : 'text-red-600'}`}>
                {fmt(overallProfitLoss)} ({fmtPct(overallProfitLossPercentage)})
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">
                {t('plPercent')}
                {navStale && <span title={t('navStaleTooltip')} className="ml-1 text-amber-500">⚠</span>}
              </p>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{fmtPct(overallProfitLossPercentage)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">{t('investmentAssets')}</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{fmt(currentValue)}</p>
            </div>
          </div>
        </div>

        {/* Time range selector */}
        <div className="flex gap-1 flex-shrink-0 ml-4">
          {TIME_RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setTimeRange(r)}
              className={`h-8 px-2.5 text-sm font-medium rounded-lg transition-colors ${
                timeRange === r
                  ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-[160px]">
        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="netWorthGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} tickFormatter={fmtShort} width={55} />
              <Tooltip
                formatter={(v) => fmt(Number(v))}
                contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '12px' }}
              />
              <Area type="monotone" dataKey="value" stroke="#8b5cf6" strokeWidth={2} fill="url(#netWorthGradient)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <div className="w-full h-px bg-gradient-to-r from-transparent via-violet-300 dark:via-violet-700 to-transparent mb-3" />
            <p className="text-xs text-gray-400 dark:text-gray-500">{t('noHistoryYet')}</p>
            <p className="text-xs text-violet-600 dark:text-violet-400 font-semibold mt-0.5">{fmt(netWorth)}</p>
          </div>
        )}
      </div>
    </div>
  )
}
