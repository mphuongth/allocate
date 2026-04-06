'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'

const fmt = (n: number | null) => n != null ? '₫ ' + Math.round(n).toLocaleString('vi-VN') : '—'

interface GoalOption {
  id: string
  name: string
  targetAmount: number | null
  currentValue: number
  progressPercent: number | null
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  fundId: string
  fundName: string
  goals: GoalOption[]
  onConfirm: (goalId: string) => void
  onCancel: () => void
  isLoading: boolean
  error: string
}

export default function GoalPickerModal({ open, onOpenChange, fundName, goals, onConfirm, onCancel, isLoading, error }: Props) {
  const t = useTranslations('dashboard')
  const tc = useTranslations('common')
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !isLoading) { onCancel(); onOpenChange(false) } }}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{t('assignToGoalTitle')}</DialogTitle>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{fundName}</p>
        </DialogHeader>

        {error && (
          <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="overflow-y-auto max-h-[340px] -mx-1 px-1 py-1 space-y-1">
          {goals.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">{t('noGoalsYet')}</p>
          ) : (
            goals.map((goal) => (
              <button
                key={goal.id}
                onClick={() => setSelected(goal.id)}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors border min-h-[44px] ${
                  selected === goal.id
                    ? 'border-violet-300 bg-violet-50 dark:bg-violet-900/20'
                    : 'border-transparent hover:border-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/10'
                }`}
              >
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{goal.name}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs text-gray-400 dark:text-gray-500">{t('goalTarget', { amount: fmt(goal.targetAmount) })}</span>
                  {goal.progressPercent != null && (
                    <span className="text-xs text-gray-400 dark:text-gray-500">{t('goalProgress', { pct: Math.round(goal.progressPercent) })}</span>
                  )}
                </div>
                {goal.progressPercent != null && (
                  <Progress value={Math.min(100, Math.max(0, goal.progressPercent))} className="h-1 mt-2" />
                )}
              </button>
            ))
          )}
        </div>

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel} disabled={isLoading}>
            {tc('cancel')}
          </Button>
          <Button
            className="flex-1 bg-gray-950 hover:bg-gray-800"
            onClick={() => selected && onConfirm(selected)}
            disabled={!selected || isLoading}
          >
            {isLoading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />}
            {isLoading ? t('assigningGoalBtn') : t('assignGoalBtn')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
