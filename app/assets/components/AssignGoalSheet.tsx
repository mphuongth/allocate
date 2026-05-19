'use client'

import { useState, useEffect } from 'react'
import { Check } from 'lucide-react'
import { useLocale } from 'next-intl'
import { fmt } from '@/lib/formatters'

interface GoalOption {
  id: string
  name: string
  currentValue: number
  progressPercent: number | null
}

interface Props {
  open: boolean
  onClose: () => void
  /** Called with the selected goalId. Should throw on failure. */
  onConfirm: (goalId: string) => Promise<void>
}

export default function AssignGoalSheet({ open, onClose, onConfirm }: Props) {
  const isVI = useLocale() === 'vi'
  const [mounted, setMounted] = useState(false)
  const [goals, setGoals] = useState<GoalOption[]>([])
  const [goalsLoading, setGoalsLoading] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [successName, setSuccessName] = useState('')

  useEffect(() => {
    if (open) {
      setMounted(true)
      setSelected(null)
      setError('')
      setSuccess(false)
      setGoalsLoading(true)
      fetch('/api/v1/savings-goals')
        .then((r) => r.ok ? r.json() : { goals: [] })
        .then((res: { goals?: Array<{ goal_id: string; goal_name: string; current_value?: number; progress_percentage?: number | null }> }) => {
          const rows = res.goals ?? []
          setGoals(rows.map((g) => ({
            id: g.goal_id,
            name: g.goal_name,
            currentValue: g.current_value ?? 0,
            progressPercent: g.progress_percentage ?? null,
          })))
        })
        .catch(() => setGoals([]))
        .finally(() => setGoalsLoading(false))
    } else {
      const t = setTimeout(() => setMounted(false), 220)
      return () => clearTimeout(t)
    }
  }, [open])

  async function handleConfirm() {
    if (!selected) return
    setConfirming(true)
    setError('')
    try {
      await onConfirm(selected)
      const goalName = goals.find((g) => g.id === selected)?.name ?? ''
      setSuccessName(goalName)
      setSuccess(true)
      setTimeout(() => onClose(), 1500)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : (isVI ? 'Lỗi kết nối' : 'Connection error'))
    }
    setConfirming(false)
  }

  if (!mounted) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.2)',
        zIndex: 100, pointerEvents: open ? 'auto' : 'none',
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'var(--c-card)', borderRadius: '16px 16px 0 0',
          padding: '0 0 env(safe-area-inset-bottom,0)',
          maxHeight: '80vh', display: 'flex', flexDirection: 'column',
          animation: open
            ? 'slide-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1)'
            : 'slide-down 180ms ease forwards',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 36, height: 4, background: 'var(--c-line-strong)', borderRadius: 999, margin: '6px auto 0', flexShrink: 0 }} />

        <div style={{ padding: '14px 16px 0', flexShrink: 0 }}>
          <p style={{ fontWeight: 700, fontSize: 16, color: 'var(--c-ink)' }}>
            {isVI ? 'Gán vào mục tiêu' : 'Assign to goal'}
          </p>
        </div>

        {success ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 16px' }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: 'var(--c-pos-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12,
            }}>
              <Check size={28} color="var(--c-pos)" />
            </div>
            <p style={{ fontWeight: 700, fontSize: 15, color: 'var(--c-ink)' }}>
              {isVI ? `Đã gán vào ${successName}` : `Assigned to ${successName}`}
            </p>
          </div>
        ) : (
          <>
            {error && (
              <p style={{ fontSize: 13, color: 'var(--c-neg)', padding: '8px 16px 0' }}>{error}</p>
            )}

            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 0' }}>
              {goalsLoading && (
                <p style={{ color: 'var(--c-muted)', fontSize: 14, textAlign: 'center', padding: '24px 0' }}>
                  {isVI ? 'Đang tải…' : 'Loading…'}
                </p>
              )}
              {!goalsLoading && goals.length === 0 && (
                <p style={{ color: 'var(--c-muted)', fontSize: 14, textAlign: 'center', padding: '24px 0' }}>
                  {isVI ? 'Chưa có mục tiêu nào' : 'No goals yet'}
                </p>
              )}
              {!goalsLoading && goals.map((g) => {
                const isSelected = selected === g.id
                return (
                  <button
                    key={g.id}
                    onClick={() => setSelected(g.id)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '12px 14px', marginBottom: 8, borderRadius: 12, cursor: 'pointer',
                      border: `2px solid ${isSelected ? 'var(--c-navy)' : 'var(--c-line)'}`,
                      background: isSelected ? 'var(--c-navy-tint)' : 'var(--c-card)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <p style={{ fontWeight: 600, fontSize: 14, color: 'var(--c-ink)' }}>{g.name}</p>
                      {g.progressPercent != null && (
                        <p style={{ fontSize: 12, color: 'var(--c-muted)' }}>
                          {Math.round(g.progressPercent)}%
                        </p>
                      )}
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--c-muted)', marginTop: 2 }}>{fmt(g.currentValue)}</p>
                    {g.progressPercent != null && (
                      <div style={{ height: 4, background: 'var(--c-line)', borderRadius: 999, overflow: 'hidden', marginTop: 8 }}>
                        <div style={{
                          height: '100%', borderRadius: 999,
                          width: `${Math.min(100, Math.max(0, g.progressPercent))}%`,
                          background: 'var(--c-navy)',
                        }} />
                      </div>
                    )}
                  </button>
                )
              })}
            </div>

            <div style={{ padding: '12px 16px 16px', flexShrink: 0 }}>
              <button
                onClick={handleConfirm}
                disabled={!selected || confirming}
                style={{
                  width: '100%', padding: '14px 0', borderRadius: 12, border: 'none',
                  background: selected ? 'var(--c-navy)' : 'var(--c-line)',
                  color: selected ? '#fff' : 'var(--c-muted)',
                  fontSize: 15, fontWeight: 700,
                  cursor: selected && !confirming ? 'pointer' : 'default',
                  opacity: confirming ? 0.7 : 1,
                  transition: 'background 0.15s',
                }}
              >
                {confirming
                  ? (isVI ? 'Đang xử lý…' : 'Assigning…')
                  : (isVI ? 'Xác nhận gán' : 'Confirm assignment')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
