'use client'

import { useState } from 'react'
import { Shield, Plus, AlertTriangle } from 'lucide-react'

interface Props {
  goalCount: number
  locale: string
  onAdd: () => void
}

const DISMISS_KEY = 'cairn.insuranceCoachDismissed'

/**
 * Empty state for the Insurance section. Shows a risk-framed "coach" prompt
 * encouraging the user to protect their goals; tapping "Later" collapses it to
 * a quiet placeholder (persisted) so the section never disappears — there is
 * always a path to add a member.
 */
export default function InsuranceEmpty({ goalCount, locale, onAdd }: Props) {
  const isVi = locale === 'vi'
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
  })

  function dismiss() {
    setDismissed(true)
    try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* ignore */ }
  }

  if (dismissed) {
    return (
      <div data-testid="insurance-empty-quiet" className="cn-card" style={{ padding: '18px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 9, background: 'var(--c-card-2)',
          color: 'var(--c-accent-insurance)', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Shield size={17} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {isVi ? 'Chưa có thành viên nào' : 'No members yet'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 2, lineHeight: 1.5 }}>
            {isVi ? 'Bạn có thể thêm bất kỳ lúc nào.' : 'Add one whenever you’re ready.'}
          </div>
        </div>
        <button data-testid="insurance-empty-add" onClick={onAdd} className="cn-btn" style={{ padding: '7px 11px', fontSize: 12, gap: 4 }}>
          <Plus size={11} strokeWidth={2.4} />
          {isVi ? 'Thêm' : 'Add'}
        </button>
      </div>
    )
  }

  return (
    <div data-testid="insurance-empty" className="cn-card" style={{ overflow: 'hidden' }}>
      <div style={{
        padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8,
        background: 'var(--c-warn-tint)', color: 'var(--c-warn)',
        borderBottom: '1px solid rgba(180, 83, 9, 0.12)',
        fontSize: 11, fontWeight: 600, letterSpacing: '0.03em',
      }}>
        <AlertTriangle size={13} strokeWidth={2.2} />
        <span style={{ flex: 1 }}>
          {isVi ? `${goalCount} mục tiêu chưa được bảo vệ` : `${goalCount} goals are unprotected`}
        </span>
      </div>

      <div style={{ padding: '16px 16px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 9, background: 'var(--c-card-2)',
            color: 'var(--c-accent-insurance)', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Shield size={17} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              {isVi ? 'Thêm bảo hiểm để giữ vững kế hoạch' : 'Add insurance to keep your plan on track'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 4, lineHeight: 1.55 }}>
              {isVi
                ? 'Một sự cố y tế có thể buộc bạn rút từ các khoản đầu tư. Bảo hiểm giữ tiền của bạn cho mục tiêu đã định.'
                : 'A medical event can force you to liquidate investments. Insurance keeps that money on its original goal.'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button data-testid="insurance-empty-add" onClick={onAdd} className="cn-btn primary" style={{ flex: 1, justifyContent: 'center' }}>
            <Plus size={13} strokeWidth={2.2} />
            {isVi ? 'Thêm thành viên' : 'Add member'}
          </button>
          <button data-testid="insurance-empty-later" onClick={dismiss} className="cn-btn ghost" style={{ color: 'var(--c-muted)' }}>
            {isVi ? 'Để sau' : 'Later'}
          </button>
        </div>
      </div>
    </div>
  )
}
