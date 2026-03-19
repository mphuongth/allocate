'use client'

import { useState, useEffect, useCallback } from 'react'
import { Trash2 } from 'lucide-react'

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')

interface SavingsRecord {
  id: string
  amount_saved_vnd: number
  created_at: string
}

interface Props {
  insuranceId: string
  insuranceName: string
  coverageType: string | null
  annualPremium: number
  amountSaved: number
  savingsProgressPercentage: number
  status: 'on_track' | 'upcoming' | 'overdue' | 'completed'
  nextPaymentDate: string | null
  onSavingsChange?: () => void
}

const statusConfig = {
  on_track: { label: 'On Track', className: 'bg-green-100 text-green-700' },
  upcoming: { label: 'Upcoming', className: 'bg-yellow-100 text-yellow-700' },
  overdue: { label: 'Overdue', className: 'bg-red-100 text-red-700' },
  completed: { label: 'Completed', className: 'bg-gray-100 text-gray-500' },
}

export default function InsuranceCard({
  insuranceId, insuranceName, coverageType, annualPremium, amountSaved,
  savingsProgressPercentage, status, nextPaymentDate, onSavingsChange,
}: Props) {
  const cfg = statusConfig[status]
  const isCompleted = status === 'completed'
  const progress = Math.min(savingsProgressPercentage, 100)

  const [inputAmount, setInputAmount] = useState('')
  const [savingsList, setSavingsList] = useState<SavingsRecord[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchSavings = useCallback(async () => {
    const res = await fetch(`/api/v1/insurance-members/${insuranceId}/savings`)
    if (res.ok) {
      const { savings } = await res.json()
      setSavingsList(savings ?? [])
    }
  }, [insuranceId])

  useEffect(() => { fetchSavings() }, [fetchSavings])

  async function handleAdd() {
    const amount = Number(inputAmount)
    if (!inputAmount || isNaN(amount) || amount <= 0) {
      showToast('Amount must be greater than 0', 'error')
      return
    }
    setIsLoading(true)
    const res = await fetch('/api/v1/insurance-savings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ insurance_member_id: insuranceId, amount_saved_vnd: amount }),
    })
    if (res.ok) {
      setInputAmount('')
      await fetchSavings()
      onSavingsChange?.()
      showToast('Savings added')
    } else {
      showToast('Failed to add savings', 'error')
    }
    setIsLoading(false)
  }

  async function handleDelete(id: string) {
    setIsLoading(true)
    const res = await fetch(`/api/v1/insurance-savings/${id}`, { method: 'DELETE' })
    if (res.ok) {
      await fetchSavings()
      onSavingsChange?.()
      showToast('Record deleted')
    } else {
      showToast('Failed to delete', 'error')
    }
    setIsLoading(false)
  }

  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-100 p-5 ${isCompleted ? 'opacity-60' : ''}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-1">
        <h3 className="font-semibold text-gray-900 text-sm">{insuranceName}</h3>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.className}`}>{cfg.label}</span>
      </div>

      {coverageType && (
        <p className="text-xs text-gray-400 mb-3">{coverageType}</p>
      )}

      <div className="grid grid-cols-2 gap-3 mb-3 text-xs">
        <div>
          <p className="text-gray-400 mb-0.5">Annual Premium</p>
          <p className="font-medium text-gray-800">{fmt(annualPremium)}</p>
        </div>
        <div>
          <p className="text-gray-400 mb-0.5">Amount Saved</p>
          <p className="font-medium text-gray-800">{fmt(amountSaved)}</p>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
          <span>Savings Progress</span>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${isCompleted ? 'bg-gray-400' : 'bg-indigo-500'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {nextPaymentDate && !isCompleted && (
        <p className="text-xs text-gray-400 mt-2">
          Next payment: {new Date(nextPaymentDate).toLocaleDateString('vi-VN')}
        </p>
      )}

      {/* Toast */}
      {toast && (
        <p className={`text-xs mt-2 ${toast.type === 'error' ? 'text-red-600' : 'text-green-600'}`}>
          {toast.msg}
        </p>
      )}

      {/* Add Savings */}
      <div className="border-t border-gray-100 mt-3 pt-3">
        <p className="text-xs font-medium text-gray-600 mb-2">Add Savings</p>
        <div className="flex gap-2">
          <input
            type="number"
            value={inputAmount}
            onChange={(e) => setInputAmount(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="Enter amount (VND)"
            className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={handleAdd}
            disabled={isLoading}
            className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
          >
            Add
          </button>
        </div>
      </div>

      {/* Savings Records */}
      {savingsList.length > 0 && (
        <div className="border-t border-gray-100 mt-3 pt-3">
          <p className="text-xs font-medium text-gray-600 mb-2">Savings Records</p>
          <ul className="space-y-1.5">
            {savingsList.map((s) => (
              <li key={s.id} className="flex items-center justify-between">
                <span className="text-xs text-gray-700">{fmt(s.amount_saved_vnd)}</span>
                <button
                  onClick={() => handleDelete(s.id)}
                  disabled={isLoading}
                  className="text-gray-300 hover:text-red-500 disabled:opacity-40 transition-colors"
                  aria-label="Delete"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
