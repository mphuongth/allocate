'use client'

import { useState, useEffect } from 'react'

interface GoldPriceData {
  price_per_chi: number
  updated_at: string
}

interface Props {
  onRefresh: () => void
}

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')

function timeAgo(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'vừa xong'
  if (mins < 60) return `${mins} phút trước`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} giờ trước`
  return `${Math.floor(hrs / 24)} ngày trước`
}

export default function GoldPriceWidget({ onRefresh }: Props) {
  const [priceData, setPriceData] = useState<GoldPriceData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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
        setError(e ?? 'Không thể lấy giá vàng')
      } else {
        const data = await res.json()
        setPriceData(data)
        onRefresh()
      }
    } catch {
      setError('Lỗi kết nối')
    }
    setLoading(false)
  }

  return (
    <div className="flex items-center justify-between px-5 py-3 bg-amber-50 dark:bg-amber-900/10 border-b border-amber-100 dark:border-amber-800/30">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-amber-600 dark:text-amber-400 text-sm">Giá vàng Doji</span>
        {priceData ? (
          <span className="font-semibold text-amber-800 dark:text-amber-200 text-sm">
            {fmt(priceData.price_per_chi)} / chỉ
          </span>
        ) : (
          <span className="text-amber-400 dark:text-amber-600 text-sm">Chưa cập nhật</span>
        )}
        {priceData && (
          <span className="text-xs text-amber-500 dark:text-amber-500 hidden sm:inline">
            · {timeAgo(priceData.updated_at)}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 ml-3 flex-shrink-0">
        {error && <span className="text-xs text-red-500">{error}</span>}
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="text-xs px-2.5 py-1 border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 rounded-md hover:bg-amber-100 dark:hover:bg-amber-900/30 disabled:opacity-50 whitespace-nowrap"
        >
          {loading ? 'Đang lấy...' : 'Làm mới giá'}
        </button>
      </div>
    </div>
  )
}
