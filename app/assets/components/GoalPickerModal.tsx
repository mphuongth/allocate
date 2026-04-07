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
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('assignToGoalTitle')}</DialogTitle>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{fundName}</p>
        </DialogHeader>

        {error && (
          <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="overflow-y-auto max-h-[400px] space-y-3 py-2">
          {goals.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">{t('noGoalsYet')}</p>
          ) : (
            goals.map((goal) => (
              <button
                key={goal.id}
                onClick={() => setSelected(goal.id)}
                className={`w-full text-left p-4 rounded-lg transition-colors border ${
                  selected === goal.id
                    ? 'border-violet-300 bg-violet-50 dark:bg-violet-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/10'
                }`}
              >
                <div className="mb-3">
                  <p className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">{goal.name}</p>
                  <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
                    <span>{t('goalTarget', { amount: fmt(goal.targetAmount) })}</span>
                    {goal.progressPercent != null && (
                      <span className="font-medium text-violet-600 dark:text-violet-400">{t('goalProgress', { pct: Math.round(goal.progressPercent) })}</span>
                    )}
                  </div>
                </div>
                {goal.progressPercent != null && (
                  <Progress value={Math.min(100, Math.max(0, goal.progressPercent))} className="h-2" />
                )}
              </button>
            ))
          )}
        </div>

        <div className="flex gap-3 mt-2">
          <Button variant="outline" className="flex-1" onClick={onCancel} disabled={isLoading}>
            {tc('cancel')}
          </Button>
          <Button
            className="flex-1 bg-violet-600 hover:bg-violet-700"
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
