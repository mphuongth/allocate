'use client'

import { useEffect, useRef, useState } from 'react'

const fmt = (n: number | null) => n != null ? '₫ ' + Math.round(n).toLocaleString('vi-VN') : '—'

interface GoalOption {
  id: string
  name: string
  targetAmount: number | null
  currentValue: number
  progressPercent: number | null
}

interface Props {
  fundId: string
  fundName: string
  goals: GoalOption[]
  onConfirm: (goalId: string) => void
  onCancel: () => void
  isLoading: boolean
  error: string
}

export default function GoalPickerModal({ fundName, goals, onConfirm, onCancel, isLoading, error }: Props) {
  const [selected, setSelected] = useState<string | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onCancel])

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === overlayRef.current && !isLoading) onCancel() }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Assign to Goal</h2>
            <p className="text-xs text-gray-400 mt-0.5">{fundName}</p>
          </div>
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 disabled:opacity-50"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {error && (
          <div className="px-6 pt-4">
            <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          </div>
        )}

        <div className="overflow-y-auto flex-1 px-2 py-2">
          {goals.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No goals available</p>
          ) : (
            goals.map((goal) => (
              <button
                key={goal.id}
                onClick={() => setSelected(goal.id)}
                className={`w-full text-left px-4 py-3 rounded-lg mb-1 transition-colors min-h-[44px] ${
                  selected === goal.id ? 'bg-indigo-50 border border-indigo-300' : 'hover:bg-gray-50 border border-transparent'
                }`}
              >
                <p className="text-sm font-medium text-gray-900">{goal.name}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs text-gray-400">Target: {fmt(goal.targetAmount)}</span>
                  {goal.progressPercent != null && (
                    <span className="text-xs text-gray-400">{Math.round(goal.progressPercent)}% complete</span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="flex-1 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 min-h-[44px]"
          >
            Cancel
          </button>
          <button
            onClick={() => selected && onConfirm(selected)}
            disabled={!selected || isLoading}
            className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2 min-h-[44px]"
          >
            {isLoading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {isLoading ? 'Assigning...' : 'Assign'}
          </button>
        </div>
      </div>
    </div>
  )
}
