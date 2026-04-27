'use client'

import { useTranslations } from 'next-intl'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')
const fmtNav = (n: number) => '₫ ' + n.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtUnits = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 2 })
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

interface PurchaseHistory {
  purchase_date: string
  units: number
  nav_at_purchase: number
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
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
  open, onOpenChange,
  fundName, currentNAV, quantity, currentValue, purchasePrice,
  profitLoss, profitLossPercentage, purchaseHistory, onClose,
}: Props) {
  const t = useTranslations('dashboard')
  const plPositive = profitLoss >= 0

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); onOpenChange(o) }}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{fundName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Summary stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{t('currentNav')}</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{fmtNav(currentNAV)}</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{t('unitsHeld')}</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{fmtUnits(quantity)}</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{t('currentValue')}</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{fmt(currentValue)}</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{t('avgPurchasePrice')}</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{fmtNav(purchasePrice)}</p>
            </div>
          </div>

          {/* P&L */}
          <div className={`rounded-lg p-4 ${plPositive ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('totalGainLoss')}</p>
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
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{t('purchaseHistory')}</h3>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    {[t('colDate'), t('colUnits'), t('colNavAtPurchase')].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                  {purchaseHistory.map((row, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{new Date(row.purchase_date).toLocaleDateString()}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{fmtUnits(row.units)}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{fmtNav(row.nav_at_purchase)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
