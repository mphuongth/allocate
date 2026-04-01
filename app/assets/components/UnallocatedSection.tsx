'use client'

import { useTranslations } from 'next-intl'
import type { FundBreakdownItem, NonFundUnallocatedItem } from '../DashboardClient'

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')
const fmtNav = (n: number) => '₫ ' + n.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

const TYPE_COLORS: Record<string, string> = {
  bank: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  stock: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  gold: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
}

interface Props {
  unallocatedAmount: number
  funds: FundBreakdownItem[]
  nonFunds: NonFundUnallocatedItem[]
  onFundClick: (fundId: string) => void
  onAssignToGoal: (fundId: string) => void
  onAssignNonFundToGoal: (transactionId: string) => void
  onRefresh: () => void
}

const TYPE_LABEL_KEYS: Record<string, string> = {
  bank: 'assetBank',
  stock: 'assetStock',
  gold: 'assetGold',
}

export default function UnallocatedSection({ unallocatedAmount, funds, nonFunds, onFundClick, onAssignToGoal, onAssignNonFundToGoal, onRefresh }: Props) {
  const t = useTranslations('dashboard')
  const tt = useTranslations('transactions')
  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('sectionUnallocated')}</h2>
        <span className="text-sm text-gray-500 dark:text-gray-400">{fmt(unallocatedAmount)}</span>
      </div>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {/* Fund items */}
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
                {fund.quantity.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CCQ · NAV {fmtNav(fund.currentNAV)}
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
                {t('assignToGoal')}
              </button>
            </div>
          </div>
        ))}

        {/* Non-fund items grouped by type */}
        {nonFunds.length > 0 && (
          <div className={funds.length > 0 ? 'border-t border-gray-100 dark:border-gray-700' : ''}>
            {(['bank', 'stock', 'gold'] as const).map((type) => {
              const items = nonFunds.filter((i) => i.type === type)
              if (!items.length) return null

              const groupTotal = items.reduce((s, i) => s + i.currentValue, 0)
              const groupInvested = items.reduce((s, i) => s + i.amount, 0)
              const groupPL = groupTotal - groupInvested
              const groupPLPct = groupInvested > 0 ? (groupPL / groupInvested) * 100 : 0

              return (
                <div key={type}>
                  {/* Group header */}
                  <div className="flex items-center justify-between px-5 py-3 bg-gray-50 dark:bg-gray-800/50">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${TYPE_COLORS[type] ?? 'bg-gray-100 text-gray-700'}`}>
                        {TYPE_LABEL_KEYS[type] ? tt(TYPE_LABEL_KEYS[type]) : type}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">{items.length} {t('items')}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{fmt(groupTotal)}</span>
                      <span className={`ml-2 text-xs ${groupPL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {fmtPct(groupPLPct)}
                      </span>
                    </div>
                  </div>

                  {/* Individual items */}
                  {items.map((item, idx) => {
                    const pl = item.currentValue - item.amount
                    const plPct = item.amount > 0 ? (pl / item.amount) * 100 : 0
                    return (
                      <div
                        key={idx}
                        className="flex items-center justify-between px-5 py-3 border-t border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-800"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {new Date(item.investmentDate).toLocaleDateString('vi-VN')}
                            {item.interestRate != null && (
                              <span className="ml-2 text-blue-600 dark:text-blue-400">{item.interestRate}{t('perYear')}</span>
                            )}
                            {item.expiryDate && (
                              <span className="ml-2 text-gray-400 dark:text-gray-500">
                                {t('expiry')} {new Date(item.expiryDate).toLocaleDateString('vi-VN')}
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                            {t('invested')}: {fmt(item.amount)}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 ml-3 flex-shrink-0">
                          <div className="text-right">
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{fmt(item.currentValue)}</p>
                            <p className={`text-xs ${pl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {pl >= 0 ? '+' : ''}{fmt(pl)} ({fmtPct(plPct)})
                            </p>
                          </div>
                          <button
                            onClick={() => onAssignNonFundToGoal(item.transactionId)}
                            className="text-xs px-2 py-1 border border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 rounded-md hover:bg-indigo-50 dark:hover:bg-indigo-900/20 whitespace-nowrap"
                          >
                            {t('assignToGoal')}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
