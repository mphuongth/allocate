'use client'

import { useState, useEffect, useCallback } from 'react'
import { Check, X, TrendingUp, Building2, Coins, ArrowRight } from 'lucide-react'
import { iconHit } from './iconHit'
import { useLocale } from 'next-intl'
import { fmt, fmtCompact } from '@/lib/formatters'
import LoadError from './LoadError'
import { useDialogMount, useResetOnOpen } from '@/components/ui/useDialogMount'
import { clickAway } from '@/components/ui/clickAway'

interface GoalOption {
  id: string
  name: string
  currentValue: number
  targetAmount: number | null
  progressPercent: number | null
}

interface AssignItem {
  name: string
  value: number
  type: string
}

interface Props {
  open: boolean
  onClose: () => void
  /** Called with the selected goalId. Should throw on failure. */
  onConfirm: (goalId: string) => Promise<void>
  item?: AssignItem
  desktop?: boolean
}

const TYPE_ICON: Record<string, React.ElementType> = {
  fund:  TrendingUp,
  bank:  Building2,
  gold:  Coins,
}
const TYPE_COLOR: Record<string, string> = {
  fund:  '#2563eb',
  bank:  '#047857',
  gold:  'var(--c-fund-gold)',
  stock: '#7c3aed',
}

export default function AssignGoalSheet({ open, onClose, onConfirm, item, desktop }: Props) {
  const isVI = useLocale() === 'vi'
  const [goals, setGoals] = useState<GoalOption[]>([])
  const [goalsLoading, setGoalsLoading] = useState(false)
  const [goalsError, setGoalsError] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [successName, setSuccessName] = useState('')

  // A failed goals fetch shows a retry state — never an empty "no goals" list,
  // which would read as "you have no goals" on a transient network error.
  const loadGoals = useCallback(() => {
    setGoalsLoading(true)
    setGoalsError(false)
    fetch('/api/v1/savings-goals?stats=true')
      .then((r) => { if (!r.ok) throw new Error('load failed'); return r.json() })
      .then((res: { goals?: Array<{ goal_id: string; goal_name: string; current_value?: number; target_amount?: number | null; progress_percentage?: number | null }> }) => {
        const rows = res.goals ?? []
        setGoals(rows.map((g) => ({
          id: g.goal_id,
          name: g.goal_name,
          currentValue: g.current_value ?? 0,
          targetAmount: g.target_amount ?? null,
          progressPercent: g.progress_percentage ?? null,
        })))
      })
      .catch(() => setGoalsError(true))
      .finally(() => setGoalsLoading(false))
  }, [])

  const mounted = useDialogMount(open)

  // Clearing during render means the previous selection — and the previous
  // account's goal list — never paint on reopen. The loading flag is set here
  // too, not in the effect below: the sheet is now mounted on the same commit
  // that opens it, so a flag raised in a passive effect would arrive one painted
  // frame late and the stale list would show first.
  useResetOnOpen(open, () => {
    setSelected(null)
    setError('')
    setSuccess(false)
    setGoals([])
    setGoalsError(false)
    setGoalsLoading(true)
  })

  // The loading flag itself is already raised during render by the reset above,
  // so the first frame shows "Loading…". This effect only issues the request —
  // loadGoals re-raises the flag for a retry, which is what the rule sees.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data load; see above
    if (open) loadGoals()
  }, [open, loadGoals])

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

  if (desktop ? !open : !mounted) return null

  const title = isVI ? 'Gán vào mục tiêu' : 'Assign to goal'
  const selectedGoal = goals.find((g) => g.id === selected)

  const ItemIcon = item ? (TYPE_ICON[item.type] ?? TrendingUp) : null
  const itemIconColor = item ? (TYPE_COLOR[item.type] ?? 'var(--c-navy)') : 'var(--c-navy)'

  const body = success ? (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 0', textAlign: 'center' }}>
      <div style={{
        width: 56, height: 56, borderRadius: '50%',
        background: 'var(--c-pos-tint)', color: 'var(--c-pos)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12,
      }}>
        <Check size={28} strokeWidth={2.5} />
      </div>
      <p style={{ fontWeight: 600, fontSize: 15, color: 'var(--c-ink)', margin: '0 0 4px' }}>
        {isVI ? 'Đã gán vào' : 'Assigned to'}
      </p>
      <p style={{ fontSize: 13, color: 'var(--c-navy)', fontWeight: 600, margin: 0 }}>{successName}</p>
    </div>
  ) : (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* Item chip */}
      {item && ItemIcon && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--c-card-2)', borderRadius: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--c-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: itemIconColor, border: '1px solid var(--c-line)', flexShrink: 0 }}>
            <ItemIcon size={15} strokeWidth={1.8} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--c-ink)' }}>{item.name}</div>
            <div style={{ fontSize: 11, color: 'var(--c-muted)', fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(item.value)}</div>
          </div>
          <ArrowRight size={14} color="var(--c-muted)" />
          <div style={{
            fontSize: 12, fontWeight: 600, padding: '4px 10px',
            background: selectedGoal ? 'var(--c-navy-tint)' : 'var(--c-line)',
            color: selectedGoal ? 'var(--c-navy)' : 'var(--c-muted)',
            borderRadius: 8, whiteSpace: 'nowrap', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {selectedGoal ? selectedGoal.name : (isVI ? 'Chọn...' : 'Choose…')}
          </div>
        </div>
      )}

      {error && (
        <p style={{ fontSize: 13, color: 'var(--c-neg)', margin: 0 }}>{error}</p>
      )}

      {/* Goal list */}
      <div>
        <div style={{ fontSize: 11, color: 'var(--c-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
          {isVI ? 'Chọn mục tiêu' : 'Choose a goal'}
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {goalsLoading && (
            <p style={{ color: 'var(--c-muted)', fontSize: 14, textAlign: 'center', padding: '24px 0', margin: 0 }}>
              {isVI ? 'Đang tải…' : 'Loading…'}
            </p>
          )}
          {!goalsLoading && goalsError && (
            <LoadError isVI={isVI} onRetry={loadGoals} retrying={goalsLoading} />
          )}
          {!goalsLoading && !goalsError && goals.length === 0 && (
            <p style={{ color: 'var(--c-muted)', fontSize: 14, textAlign: 'center', padding: '24px 0', margin: 0 }}>
              {isVI ? 'Chưa có mục tiêu nào' : 'No goals yet'}
            </p>
          )}
          {!goalsLoading && !goalsError && goals.map((g) => {
            const isSel = selected === g.id
            const isComplete = g.progressPercent != null && g.progressPercent >= 100
            const remaining = g.targetAmount != null ? Math.max(0, g.targetAmount - g.currentValue) : null
            return (
              <button
                key={g.id}
                onClick={() => setSelected(g.id)}
                style={{
                  width: '100%', textAlign: 'left', padding: '12px 14px',
                  background: isSel ? 'var(--c-navy-tint)' : 'var(--c-card)',
                  border: `1.5px solid ${isSel ? 'var(--c-navy)' : 'var(--c-line)'}`,
                  borderRadius: 12, cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'border-color 120ms, background 120ms',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: isSel ? 'var(--c-navy)' : 'var(--c-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {g.name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                      {isComplete
                        ? (isVI ? 'Đã hoàn thành' : 'Completed')
                        : remaining != null
                          ? `${fmtCompact(remaining)} ${isVI ? 'còn lại' : 'remaining'}`
                          : fmt(g.currentValue)}
                    </div>
                  </div>
                  {g.progressPercent != null && (
                    <div style={{ fontSize: 12, fontWeight: 600, color: isSel ? 'var(--c-navy)' : 'var(--c-ink)', flexShrink: 0 }}>
                      {Math.round(g.progressPercent)}%
                    </div>
                  )}
                  {isSel && (
                    <div style={{ width: 20, height: 20, borderRadius: 10, background: 'var(--c-btn-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Check size={12} strokeWidth={2.5} color="#fff" />
                    </div>
                  )}
                </div>
                {g.progressPercent != null && (
                  <div style={{ height: 4, background: 'var(--c-card-2)', borderRadius: 999, overflow: 'hidden', marginTop: 8 }}>
                    <div style={{
                      height: '100%', borderRadius: 999,
                      width: `${Math.min(100, Math.max(0, g.progressPercent))}%`,
                      background: isComplete ? 'var(--c-pos)' : 'var(--c-navy)',
                    }} />
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button
          onClick={onClose}
          className="cn-btn"
          style={{ flex: 1, justifyContent: 'center', border: '1px solid var(--c-line)' }}
        >
          {isVI ? 'Hủy' : 'Cancel'}
        </button>
        <button
          onClick={handleConfirm}
          disabled={!selected || confirming}
          className={selected && !confirming ? 'cn-btn primary' : 'cn-btn'}
          style={{ flex: 2, justifyContent: 'center', opacity: !selected || confirming ? 0.5 : 1 }}
        >
          {confirming ? (isVI ? 'Đang xử lý…' : 'Assigning…') : (
            <>
              <Check size={14} strokeWidth={2.4} />
              {isVI ? 'Xác nhận gán' : 'Confirm assignment'}
            </>
          )}
        </button>
      </div>
    </div>
  )

  if (desktop) {
    return (
      <div
        // A selection dragged out of the panel releases here; that is not a
        // click-away, and it used to close the sheet mid-edit.
        {...clickAway(onClose)}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', zIndex: 200,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          animation: 'fade-in 150ms ease', backdropFilter: 'blur(2px)',
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
          style={{
            width: '100%', maxWidth: 460, maxHeight: 'calc(100vh - 48px)',
            background: 'var(--c-card)', borderRadius: 16,
            boxShadow: '0 24px 48px rgba(15,23,42,0.18), 0 8px 16px rgba(15,23,42,0.08)',
            display: 'flex', flexDirection: 'column',
            animation: 'modal-in 200ms cubic-bezier(0.2,0.8,0.2,1)', overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px 14px', borderBottom: '1px solid var(--c-line)', flexShrink: 0 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>{title}</h3>
            <button onClick={onClose} aria-label="Close" style={{ ...iconHit, border: 'none', background: 'transparent', borderRadius: 8, cursor: 'pointer', color: 'var(--c-muted)' }}><X size={18} /></button>
          </div>
          <div style={{ flex: 1, padding: '18px 20px', overflowY: 'auto' }}>
            {body}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.2)',
        zIndex: 100, pointerEvents: open ? 'auto' : 'none',
      }}
      // A selection dragged out of the panel releases here; that is not a
      // click-away, and it used to close the sheet mid-edit.
      {...clickAway(onClose)}
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
          <p style={{ fontWeight: 700, fontSize: 16, color: 'var(--c-ink)', margin: 0 }}>{title}</p>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 16px' }}>
          {body}
        </div>
      </div>
    </div>
  )
}
