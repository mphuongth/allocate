'use client'

import { useState, useEffect } from 'react'
import { TrendingUp, ArrowUpRight, ArrowDownRight, Minus, RefreshCw } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface GoldPriceData {
  price_per_chi: number
  previous_price_per_chi: number | null
  updated_at: string
}

interface Props {
  onRefresh: () => void
}

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')

export default function GoldPriceWidget({ onRefresh }: Props) {
  const t = useTranslations('dashboard')
  const [priceData, setPriceData] = useState<GoldPriceData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function timeAgo(isoDate: string): string {
    const diffMs = Date.now() - new Date(isoDate).getTime()
    const mins = Math.floor(diffMs / 60000)
    if (mins < 1) return t('timeJustNow')
    if (mins < 60) return t('timeMinsAgo', { mins })
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return t('timeHrsAgo', { hrs })
    return t('timeDaysAgo', { days: Math.floor(hrs / 24) })
  }

  async function loadPrice() {
    const res = await fetch('/api/v1/gold-price')
    if (res.ok) {
      const data = await res.json()
      setPriceData(data)
    }
  }

  useEffect(() => { loadPrice() }, [])

  async function handleRefresh() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/gold-price/refresh', { method: 'POST' })
      if (!res.ok) {
        const { error: e } = await res.json()
        setError(e ?? t('goldPriceError'))
      } else {
        const data = await res.json()
        setPriceData(data)
        onRefresh()
      }
    } catch {
      setError(t('goldPriceConnError'))
    }
    setLoading(false)
  }

  const changePct = priceData?.previous_price_per_chi && priceData.previous_price_per_chi > 0
    ? ((priceData.price_per_chi - priceData.previous_price_per_chi) / priceData.previous_price_per_chi) * 100
    : null

  const changePositive = changePct !== null && changePct > 0
  const changeNegative = changePct !== null && changePct < 0

  return (
    <div className="bg-gradient-to-r from-amber-50 to-amber-100 dark:from-amber-900/10 dark:to-amber-900/20 border border-amber-200 dark:border-amber-800/30 rounded-xl px-6 py-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Left: icon + price info */}
        <div className="flex items-center gap-4">
          {/* Gold icon — matches redesign */}
          <div className="h-10 w-10 rounded-full bg-amber-500 flex items-center justify-center flex-shrink-0">
            <TrendingUp className="h-5 w-5 text-white" />
          </div>

          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              {t('goldPrice')}
            </p>
            {priceData ? (
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-lg font-semibold text-amber-900 dark:text-amber-100">
                  {fmt(priceData.price_per_chi)}
                </span>
                <span className="text-xs text-amber-700 dark:text-amber-400">{t('goldPriceUnit')}</span>
              </div>
            ) : (
              <span className="text-sm text-amber-500 dark:text-amber-600">{t('goldPriceNotUpdated')}</span>
            )}
            {priceData && (
              <p className="text-xs text-amber-700 dark:text-amber-500 mt-0.5">
                {timeAgo(priceData.updated_at)}
              </p>
            )}
          </div>
        </div>

        {/* Right: daily change + refresh */}
        <div className="flex items-center gap-4 flex-shrink-0">
          {changePct !== null && (
            <div className="text-right">
              <span className={`inline-flex items-center gap-0.5 text-sm font-medium ${
                changePositive ? 'text-green-600 dark:text-green-400' :
                changeNegative ? 'text-red-500 dark:text-red-400' :
                'text-gray-500 dark:text-gray-400'
              }`}>
                {changePositive ? <ArrowUpRight className="h-4 w-4" /> : changeNegative ? <ArrowDownRight className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
              </span>
              <p className="text-xs text-amber-700 dark:text-amber-500 mt-0.5">{t('goldDailyChange')}</p>
            </div>
          )}
          <div className="flex items-center gap-2">
            {error && <span className="text-xs text-red-500">{error}</span>}
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 rounded-lg hover:bg-amber-200/60 dark:hover:bg-amber-900/30 disabled:opacity-50 whitespace-nowrap transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              {loading ? t('goldPriceRefreshing') : t('goldPriceRefresh')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
