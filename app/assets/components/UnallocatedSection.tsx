'use client'

import { RefreshCw, TrendingDown, Target } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { FundBreakdownItem, NonFundUnallocatedItem } from '../DashboardClient'

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')
const fmtNav = (n: number) => '₫ ' + n.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

const TYPE_BADGE: Record<string, string> = {
  // Unified with the `fund:` entry in the ASSET_COLORS maps in
  // GoalDetailClient / GoalDetailView / InvestmentTransactionsTab. Purple
  // keeps the "fund" category visually distinct from the brand emerald.
  fund:  'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  bank:  'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  gold:  'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  stock: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
}

interface Props {
  unallocatedAmount: number
  funds: FundBreakdownItem[]
  nonFunds: NonFundUnallocatedItem[]
  onFundClick: (fundId: string) => void
  onAssignToGoal: (fundId: string) => void
  onSellFund: (fund: FundBreakdownItem) => void
  onAssignNonFundToGoal: (transactionId: string) => void
  onSellNonFund: (item: NonFundUnallocatedItem) => void
  onRefresh: () => void
}

export default function UnallocatedSection({ unallocatedAmount, funds, nonFunds, onFundClick, onAssignToGoal, onSellFund, onAssignNonFundToGoal, onSellNonFund, onRefresh }: Props) {
  const t = useTranslations('dashboard')
  const tt = useTranslations('transactions')
  const tg = useTranslations('goals')

  const typeLabelMap: Record<string, string> = {
    fund:  tt('assetFund'),
    bank:  tt('assetBank'),
    gold:  tt('assetGold'),
    stock: tt('assetStock'),
  }

  return (
    <section>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="flex items-center justify-between px-5 pt-5 pb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('sectionUnallocated')}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('totalLabel')}: {fmt(unallocatedAmount)}</p>
        </div>
        <button
          onClick={onRefresh}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 border border-gray-200 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors whitespace-nowrap"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t('refreshNav')}
        </button>
      </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700">
                <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colAsset')}</th>
                <th className="px-5 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden sm:table-cell">{t('colNavInterest')}</th>
                <th className="px-5 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden md:table-cell">{t('colUnits')}</th>
                <th className="px-5 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colCurrentValue')}</th>
                <th className="px-3 sm:px-5 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('colActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
              {/* Fund rows */}
              {funds.map((fund) => (
                <tr key={fund.fundId} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-5 py-4">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium uppercase mb-1 ${TYPE_BADGE.fund}`}>
                      {typeLabelMap.fund}
                    </span>
                    <button
                      onClick={() => onFundClick(fund.fundId)}
                      className="block text-left hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                    >
                      <p className="font-medium text-gray-900 dark:text-gray-100">{fund.fundName}</p>
                    </button>
                  </td>
                  <td className="px-5 py-4 text-right text-sm text-gray-600 dark:text-gray-400 hidden sm:table-cell">
                    {fmtNav(fund.currentNAV)}
                  </td>
                  <td className="px-5 py-4 text-right text-sm text-gray-600 dark:text-gray-400 hidden md:table-cell">
                    {fund.quantity.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <p className="font-medium text-gray-900 dark:text-gray-100">{fmt(fund.currentValue)}</p>
                    <p className={`text-xs mt-0.5 ${fund.profitLoss >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {fmtPct(fund.profitLossPercentage)}
                    </p>
                  </td>
                  <td className="px-3 sm:px-5 py-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => onSellFund(fund)}
                        title={tg('sell')}
                        className="inline-flex items-center gap-1.5 text-sm font-medium px-2 py-1.5 sm:px-2.5 border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-400 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20"
                      >
                        <TrendingDown className="h-3.5 w-3.5 shrink-0" />
                        <span className="hidden sm:inline whitespace-nowrap">{tg('sell')}</span>
                      </button>
                      <button
                        onClick={() => onAssignToGoal(fund.fundId)}
                        title={t('assignToGoal')}
                        className="inline-flex items-center gap-1.5 text-sm font-medium px-2 py-1.5 sm:px-2.5 border border-gray-200 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
                      >
                        <Target className="h-3.5 w-3.5 shrink-0" />
                        <span className="hidden sm:inline whitespace-nowrap">{t('assignToGoal')}</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {/* Non-fund rows */}
              {nonFunds.map((item) => {
                const pl = item.currentValue - item.amount
                const plPct = item.amount > 0 ? (pl / item.amount) * 100 : 0
                const typeLabel = typeLabelMap[item.type] ?? item.type
                const badgeCls = TYPE_BADGE[item.type] ?? 'bg-gray-100 text-gray-700'
                return (
                  <tr key={item.transactionId} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-5 py-4">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium uppercase mb-1 ${badgeCls}`}>
                        {typeLabel}
                      </span>
                      {item.notes
                        ? <>
                            <p className="font-medium text-gray-900 dark:text-gray-100">{item.notes}</p>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                              {new Date(item.investmentDate).toLocaleDateString('vi-VN')}
                            </p>
                            {item.expiryDate && (
                              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                                {t('expiry')} {new Date(item.expiryDate).toLocaleDateString('vi-VN')}
                              </p>
                            )}
                          </>
                        : <p className="font-medium text-gray-900 dark:text-gray-100">
                            {new Date(item.investmentDate).toLocaleDateString('vi-VN')}
                          </p>
                      }
                    </td>
                    <td className="px-5 py-4 text-right text-sm text-gray-600 dark:text-gray-400 hidden sm:table-cell">
                      {item.interestRate != null
                        ? <span className="text-gray-900 dark:text-gray-100">{item.interestRate}%</span>
                        : '—'}
                    </td>
                    <td className="px-5 py-4 text-right text-sm text-gray-500 dark:text-gray-400 hidden md:table-cell">
                      {item.type === 'gold' && item.units != null
                        ? item.units.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        : '—'}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <p className="font-medium text-gray-900 dark:text-gray-100">{fmt(item.currentValue)}</p>
                      <p className={`text-xs mt-0.5 ${pl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {fmtPct(plPct)}
                      </p>
                    </td>
                    <td className="px-3 sm:px-5 py-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {(item.type === 'bank' || item.type === 'gold') && (
                          <button
                            onClick={() => onSellNonFund(item)}
                            title={item.type === 'bank' ? tg('withdraw') : tg('sell')}
                            className="inline-flex items-center gap-1.5 text-sm font-medium px-2 py-1.5 sm:px-2.5 border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-400 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20"
                          >
                            <TrendingDown className="h-3.5 w-3.5 shrink-0" />
                            <span className="hidden sm:inline whitespace-nowrap">
                              {item.type === 'bank' ? tg('withdraw') : tg('sell')}
                            </span>
                          </button>
                        )}
                        <button
                          onClick={() => onAssignNonFundToGoal(item.transactionId)}
                          title={t('assignToGoal')}
                          className="inline-flex items-center gap-1.5 text-sm font-medium px-2 py-1.5 sm:px-2.5 border border-gray-200 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
                        >
                          <Target className="h-3.5 w-3.5 shrink-0" />
                          <span className="hidden sm:inline whitespace-nowrap">{t('assignToGoal')}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
