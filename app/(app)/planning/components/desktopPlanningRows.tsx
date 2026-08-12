'use client'

// The desktop planning table's row components (#467): a goal's item row
// (DGoalItemRow, with a kebab menu) and the generic plan-table row (DPlanRow) used
// by the fixed/insurance sections, plus the shared kebab MenuBtn. Prop-driven and
// layout-only — DesktopPlanningView owns the data + action handlers.
import { useState, useRef } from 'react'
import { Check, Plus, RefreshCw, TrendingUp, MoreHorizontal, X } from 'lucide-react'
import { fmt } from '@/lib/formatters'
import { type GoalItem } from '@/lib/planning'
import { useCloseOnScroll } from '@/components/ui/useDialogA11y'
import { goalItemSublabel } from '@/features/planning/planModel'
import { EditIcon } from './planningIcons'
import { LinkLostBadge } from './LinkLostBadge'

function MenuBtn({ icon, label, onClick, danger, noBorder }: {
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; noBorder?: boolean
}) {
  return (
    <button role="menuitem" onClick={onClick} style={{ width: '100%', textAlign: 'left', padding: '10px 12px', fontSize: 12, background: 'transparent', border: 'none', borderBottom: noBorder ? 'none' : '1px solid var(--c-line)', cursor: 'pointer', fontFamily: 'inherit', color: danger ? 'var(--c-neg)' : 'var(--c-ink)', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ color: danger ? 'var(--c-neg)' : 'var(--c-muted)' }}>{icon}</span>
      {label}
    </button>
  )
}

export function DPlanRow({ primary, secondary, amount, relationship, defaultAmount, muted, last, isVI, onSkip, onRestore, onOverride }: {
  primary: string; secondary?: string | null; amount: number; relationship?: string; defaultAmount?: number; muted?: boolean
  last?: boolean; isVI: boolean; onSkip?: () => void; onRestore?: () => void; onOverride?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  useCloseOnScroll(open, () => setOpen(false))

  function openMenu() {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
    }
    setOpen(true)
  }

  return (
    <tr style={{ borderBottom: last ? 'none' : '1px solid var(--c-line)', background: 'var(--c-card)', opacity: muted ? 0.5 : 1 }}>
      <td style={{ padding: '11px 16px', verticalAlign: 'middle' }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-ink)', textDecoration: muted ? 'line-through' : 'none' }}>{primary}</div>
        {secondary && <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 1 }}>{secondary}</div>}
      </td>
      {relationship != null && (
        <td style={{ padding: '11px 12px', verticalAlign: 'middle', fontSize: 12, color: 'var(--c-muted)' }}>{relationship}</td>
      )}
      {defaultAmount != null && (
        <td style={{ padding: '11px 12px', textAlign: 'right', verticalAlign: 'middle' }}>
          <span style={{ fontSize: 12, color: 'var(--c-muted)', fontVariantNumeric: 'tabular-nums' }}>{fmt(defaultAmount)}</span>
        </td>
      )}
      <td style={{ padding: '11px 12px', textAlign: 'right', verticalAlign: 'middle' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: muted ? 'var(--c-muted)' : 'var(--c-ink)', textDecoration: muted ? 'line-through' : 'none', fontVariantNumeric: 'tabular-nums' }}>
          {fmt(amount)}
        </span>
      </td>
      <td style={{ padding: '11px 8px 11px 4px', textAlign: 'right', verticalAlign: 'middle', width: 36 }}>
        <button ref={btnRef} onClick={() => open ? setOpen(false) : openMenu()} aria-label="More options" aria-haspopup="menu" aria-expanded={open} style={{ padding: 5, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, color: 'var(--c-muted)', display: 'flex' }}>
          <MoreHorizontal size={14} />
        </button>
        {open && (
          <>
            <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 5 }} />
            <div role="menu" style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 6, background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 8, boxShadow: '0 6px 20px rgba(15,23,42,0.12)', minWidth: 170, overflow: 'hidden' }}>
              {muted ? (
                <MenuBtn icon={<Check size={13} />} label={isVI ? 'Bao gồm tháng này' : 'Include this month'} onClick={() => { onRestore?.(); setOpen(false) }} noBorder />
              ) : (
                <>
                  <MenuBtn icon={<EditIcon size={13} />} label={isVI ? 'Ghi đè số tiền' : 'Override amount'} onClick={() => { onOverride?.(); setOpen(false) }} />
                  {onRestore && <MenuBtn icon={<RefreshCw size={13} />} label={isVI ? 'Khôi phục mặc định' : 'Restore default'} onClick={() => { onRestore(); setOpen(false) }} />}
                  <MenuBtn icon={<X size={13} />} label={isVI ? 'Bỏ qua tháng này' : 'Skip this month'} onClick={() => { onSkip?.(); setOpen(false) }} danger noBorder />
                </>
              )}
            </div>
          </>
        )}
      </td>
    </tr>
  )
}

// ─── DGoalItemRow — line item under a goal ───────────────────────────────────
// Recurring savings get a kebab (save more / edit / skip). Fund DCA lines get a
// "Buy" pill to record the actual purchase, plus skip / restore for the month.

export function DGoalItemRow({ item, isVI, onSkip, onRestore, onOverride, onEdit, onRecordBuy, onRecordDeposit, onDcaSkip, onDcaRestore }: {
  item: GoalItem; isVI: boolean
  onSkip: () => void; onRestore: () => void; onOverride: () => void; onEdit: () => void
  onRecordBuy: () => void; onRecordDeposit: () => void; onDcaSkip: () => void; onDcaRestore: () => void
}) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  useCloseOnScroll(open, () => setOpen(false))
  const skipped = !!item.skipped
  const recorded = !!item.recorded

  const sublabel = goalItemSublabel(item, isVI)

  function openMenu() {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
    }
    setOpen(true)
  }

  return (
    <tr
      data-testid={item.isRecurring && item.recurringId ? `plan-recurring-${item.recurringId}` : undefined}
      data-recorded={item.isRecurring ? (recorded ? 'true' : 'false') : undefined}
      style={{ borderBottom: '1px solid var(--c-line)', background: 'var(--c-card)', opacity: skipped ? 0.5 : 1 }}
    >
      <td style={{ padding: '9px 16px 9px 44px', verticalAlign: 'middle' }}>
        <div style={{ fontSize: 12, fontWeight: 500, textDecoration: skipped ? 'line-through' : 'none' }}>{item.name}</div>
        <div style={{ fontSize: 10, color: item.overridden ? 'var(--c-navy)' : recorded ? 'var(--c-pos)' : 'var(--c-muted)', marginTop: 1 }}>
          {sublabel}
          {item.isDCA && <span style={{ marginLeft: 6, padding: '1px 5px', borderRadius: 4, background: 'var(--c-navy-tint)', color: 'var(--c-navy)', fontSize: 9, fontWeight: 700 }}>DCA</span>}
          {item.linkLost && <span style={{ marginLeft: 6 }}><LinkLostBadge item={item} isVI={isVI} /></span>}
        </div>
      </td>
      <td style={{ padding: '9px 12px', textAlign: 'right', verticalAlign: 'middle' }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--c-muted)', fontVariantNumeric: 'tabular-nums', textDecoration: skipped ? 'line-through' : 'none' }}>{fmt(item.amount)}</span>
      </td>
      <td style={{ padding: '9px 8px 9px 4px', textAlign: 'right', verticalAlign: 'middle', width: 96 }}>
        {item.isRecurring ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
            {recorded ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--c-pos)', fontSize: 11, fontWeight: 600 }}>
                <Check size={13} />{isVI ? 'Đã gửi' : 'Saved'}
              </span>
            ) : !skipped && (
              <button onClick={onRecordDeposit} aria-label={isVI ? 'Ghi nhận đã gửi' : 'Record deposit'} title={isVI ? 'Ghi nhận đã gửi — số tiền, ngày' : 'Record deposit — amount, date'}
                style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, color: 'var(--c-pos)', background: 'var(--c-pos-tint)', border: '1px solid transparent', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                <Plus size={12} strokeWidth={2.4} />{isVI ? 'Đã gửi' : 'Saved'}
              </button>
            )}
            <button ref={btnRef} onClick={() => open ? setOpen(false) : openMenu()} aria-label="Saving actions" aria-haspopup="menu" aria-expanded={open} style={{ padding: 5, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, color: 'var(--c-muted)', display: 'flex' }}>
              <MoreHorizontal size={14} />
            </button>
            {open && (
              <>
                <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 5 }} />
                <div role="menu" style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 6, background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 8, boxShadow: '0 6px 20px rgba(15,23,42,0.12)', minWidth: 200, overflow: 'hidden' }}>
                  {skipped ? (
                    <MenuBtn icon={<Check size={13} />} label={isVI ? 'Bao gồm tháng này' : 'Include this month'} onClick={() => { onRestore(); setOpen(false) }} noBorder />
                  ) : (
                    <>
                      <MenuBtn icon={<Plus size={13} />} label={isVI ? 'Ghi nhận đã gửi tháng này' : 'Record deposit this month'} onClick={() => { onRecordDeposit(); setOpen(false) }} />
                      <MenuBtn icon={<TrendingUp size={13} />} label={isVI ? 'Tiết kiệm thêm tháng này' : 'Save more this month'} onClick={() => { onOverride(); setOpen(false) }} />
                      <MenuBtn icon={<EditIcon size={13} />} label={isVI ? 'Sửa kế hoạch định kỳ' : 'Edit recurring plan'} onClick={() => { onEdit(); setOpen(false) }} />
                      {item.overridden && <MenuBtn icon={<RefreshCw size={13} />} label={isVI ? 'Khôi phục mặc định' : 'Restore default'} onClick={() => { onRestore(); setOpen(false) }} />}
                      <MenuBtn icon={<X size={13} />} label={isVI ? 'Bỏ qua tháng này' : 'Skip this month'} onClick={() => { onSkip(); setOpen(false) }} danger noBorder />
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        ) : item.isFundDca && skipped ? (
          <button onClick={onDcaRestore} aria-label="Restore DCA" style={{ padding: '4px 9px', fontSize: 11, fontWeight: 600, color: 'var(--c-muted)', background: 'transparent', border: '1px solid var(--c-line)', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Check size={12} />{isVI ? 'Khôi phục' : 'Restore'}
          </button>
        ) : item.isFundDca && recorded ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--c-pos)', fontSize: 11, fontWeight: 600 }}>
            <Check size={13} />{isVI ? 'Đã mua' : 'Bought'}
          </span>
        ) : item.isFundDca ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
            <button onClick={onRecordBuy} aria-label={isVI ? 'Ghi nhận mua' : 'Record buy'} title={isVI ? 'Ghi nhận mua — giá, số CCQ, ngày' : 'Record buy — price, units, date'}
              style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, color: 'var(--c-pos)', background: 'var(--c-pos-tint)', border: '1px solid transparent', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
              <Plus size={12} strokeWidth={2.4} />{isVI ? 'Mua' : 'Buy'}
            </button>
            <button ref={btnRef} onClick={() => open ? setOpen(false) : openMenu()} aria-label="DCA actions" aria-haspopup="menu" aria-expanded={open} style={{ padding: 5, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, color: 'var(--c-muted)', display: 'flex' }}>
              <MoreHorizontal size={14} />
            </button>
            {open && (
              <>
                <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 5 }} />
                <div role="menu" style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 6, background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 8, boxShadow: '0 6px 20px rgba(15,23,42,0.12)', minWidth: 200, overflow: 'hidden' }}>
                  <MenuBtn icon={<Plus size={13} />} label={isVI ? 'Ghi nhận mua tháng này' : 'Record buy this month'} onClick={() => { onRecordBuy(); setOpen(false) }} />
                  <MenuBtn icon={<X size={13} />} label={isVI ? 'Bỏ qua tháng này' : 'Skip this month'} onClick={() => { onDcaSkip(); setOpen(false) }} danger noBorder />
                </div>
              </>
            )}
          </div>
        ) : null}
      </td>
    </tr>
  )
}

// ─── Stacked bar ─────────────────────────────────────────────────────────────
