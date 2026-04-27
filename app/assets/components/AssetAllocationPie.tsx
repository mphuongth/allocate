'use client'

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { useTranslations } from 'next-intl'

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')

const PALETTE = [
  { key: 'equity',   color: '#8b5cf6', ns: 'funds',        labelKey: 'typeEquity' },
  { key: 'balanced', color: '#a78bfa', ns: 'funds',        labelKey: 'typeBalanced' },
  { key: 'bond',     color: '#c4b5fd', ns: 'funds',        labelKey: 'typeDebt' },
  { key: 'bank',     color: '#06b6d4', ns: 'transactions', labelKey: 'assetBank' },
  { key: 'gold',     color: '#f59e0b', ns: 'transactions', labelKey: 'assetGold' },
  { key: 'stock',    color: '#10b981', ns: 'transactions', labelKey: 'assetStock' },
] as const

interface Props {
  equityTotal: number
  bondTotal: number
  balancedTotal: number
  bankTotal: number
  goldTotal: number
  stockTotal: number
  cashTotal: number
  totalAssets: number
}

export default function AssetAllocationPie({ equityTotal, bondTotal, balancedTotal, bankTotal, goldTotal, stockTotal, totalAssets }: Props) {
  const tf = useTranslations('funds')
  const tt = useTranslations('transactions')

  const labelMap: Record<string, string> = {
    equity:   tf('typeEquity'),
    balanced: tf('typeBalanced'),
    bond:     tf('typeDebt'),
    bank:     tt('assetBank'),
    gold:     tt('assetGold'),
    stock:    tt('assetStock'),
  }

  const colorMap = Object.fromEntries(PALETTE.map((p) => [p.key, p.color]))

  const data = [
    { key: 'equity',   value: equityTotal },
    { key: 'balanced', value: balancedTotal },
    { key: 'bond',     value: bondTotal },
    { key: 'bank',     value: bankTotal },
    { key: 'gold',     value: goldTotal },
    { key: 'stock',    value: stockTotal },
  ].filter((d) => d.value > 0)

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 flex flex-col">
      <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-4">Asset Allocation</h3>

      <div className="flex-1">
        <ResponsiveContainer width="100%" height={180}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={78}
              paddingAngle={2}
              dataKey="value"
              nameKey="key"
            >
              {data.map((entry) => (
                <Cell key={entry.key} fill={colorMap[entry.key] ?? '#e5e7eb'} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name) => [fmt(Number(value)), labelMap[name as string] ?? name]}
              contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '12px' }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="space-y-2 mt-2">
        {data.map((item) => {
          const pct = totalAssets > 0 ? ((item.value / totalAssets) * 100).toFixed(0) : '0'
          return (
            <div key={item.key} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: colorMap[item.key] ?? '#e5e7eb' }} />
                <span className="text-gray-600 dark:text-gray-400">{labelMap[item.key] ?? item.key}</span>
              </div>
              <span className="font-medium text-gray-900 dark:text-gray-100">{pct}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
