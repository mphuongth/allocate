'use client'

import { useEffect, useRef } from 'react'

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

interface PurchaseHistory {
  purchase_date: string
  units: number
  nav_at_purchase: number
}

interface Props {
  fundId: string
  fundName: string
  currentNAV: number
  quantity: number
  currentValue: number
  purchasePrice: number
  profitLoss: number
  profitLossPercentage: number
  purchaseHistory: PurchaseHistory[]
  onClose: () => void
}

export default function FundDetailModal({
  fundName, currentNAV, quantity, currentValue, purchasePrice,
  profitLoss, profitLossPercentage, purchaseHistory, onClose,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const plPositive = profitLoss >= 0

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">{fundName}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {/* Summary stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-400 mb-1">Current NAV</p>
              <p className="text-sm font-semibold text-gray-900">{fmt(currentNAV)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-400 mb-1">Units Held</p>
              <p className="text-sm font-semibold text-gray-900">{quantity.toLocaleString('vi-VN')}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-400 mb-1">Current Value</p>
              <p className="text-sm font-semibold text-gray-900">{fmt(currentValue)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-400 mb-1">Avg Entry Price</p>
              <p className="text-sm font-semibold text-gray-900">{fmt(purchasePrice)}</p>
            </div>
          </div>

          {/* P&L */}
          <div className={`rounded-lg p-4 ${plPositive ? 'bg-green-50' : 'bg-red-50'}`}>
            <p className="text-xs text-gray-500 mb-1">Total Gain / Loss</p>
            <p className={`text-xl font-bold ${plPositive ? 'text-green-700' : 'text-red-700'}`}>
              {fmt(profitLoss)}
            </p>
            <p className={`text-sm ${plPositive ? 'text-green-600' : 'text-red-600'}`}>
              {fmtPct(profitLossPercentage)}
            </p>
          </div>

          {/* Purchase history */}
          {purchaseHistory.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Purchase History</h3>
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {['Date', 'Units', 'NAV at Purchase'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {purchaseHistory.map((row, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-gray-600">{new Date(row.purchase_date).toLocaleDateString('vi-VN')}</td>
                      <td className="px-3 py-2 text-gray-600">{row.units}</td>
                      <td className="px-3 py-2 text-gray-600">{fmt(row.nav_at_purchase)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
