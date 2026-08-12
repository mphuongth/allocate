'use client'

// The mobile planning view's by-goal row components (#467): a goal's allocation
// row and its per-item lines (recurring savings / DCA funds with a kebab menu),
// plus the generic plan line item used by the fixed/insurance/other sections.
// Prop-driven and layout-only — the view owns the data + action handlers.
import { useState, useRef } from 'react'
import { Check, ChevronDown, ChevronUp, MoreHorizontal, Plus, RefreshCw, Target, TrendingUp, X } from 'lucide-react'
import { fmt } from '@/lib/formatters'
import { type GoalRow, type GoalItem } from '@/lib/planning'
import { useCloseOnScroll } from '@/components/ui/useDialogA11y'
import { goalItemSublabel, goalProgress } from '@/features/planning/planModel'
import { EditIcon } from './planningIcons'
import { LinkLostBadge } from './LinkLostBadge'

export function GoalAllocationRow({ entry, isVI, onRecSkip, onRecRestore, onRecOverride, onRecEdit, onRecordBuy, onRecordDeposit, onLogContribution, onDcaSkip, onDcaRestore }: {
  entry: GoalRow; isVI: boolean
  onRecSkip: (item: GoalItem) => void
  onRecRestore: (item: GoalItem) => void
  onRecOverride: (item: GoalItem) => void
  onRecEdit: (item: GoalItem) => void
  onRecordBuy: (item: GoalItem) => void
  onRecordDeposit: (item: GoalItem) => void
  onLogContribution: () => void
  onDcaSkip: (item: GoalItem) => void
  onDcaRestore: (item: GoalItem) => void
}) {
  const [open, setOpen] = useState(false)
  const { pct, met } = goalProgress(entry)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderTop: '1px solid var(--c-line)' }}>
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            flex: 1, minWidth: 0, textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer',
            padding: 0, display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'inherit',
          }}
        >
          <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--c-navy-tint)', color: 'var(--c-navy)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Target size={14} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--c-ink)' }}>
              {entry.goalName}
            </div>
            {entry.totalAllocated > 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <div style={{ flex: 1, maxWidth: 120, height: 4, borderRadius: 999, background: 'var(--c-line)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: met ? 'var(--c-pos)' : 'var(--c-navy)', borderRadius: 999, transition: 'width 200ms' }} />
                </div>
                <span style={{ fontSize: 10, color: entry.contributed > 0 ? 'var(--c-pos)' : 'var(--c-muted)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {entry.contributed > 0 ? `${fmt(entry.contributed)} ${isVI ? 'đã góp' : 'in'}` : (isVI ? 'Chưa góp' : 'Nothing yet')}
                </span>
              </div>
            ) : (
              <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 1 }}>
                {entry.items.length} {isVI ? 'khoản' : entry.items.length === 1 ? 'allocation' : 'allocations'}
              </div>
            )}
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--c-ink)' }}>
            {fmt(entry.totalAllocated)}
          </span>
        </button>
        <button
          onClick={onLogContribution}
          aria-label={isVI ? 'Ghi nhận đóng góp' : 'Log contribution'}
          title={isVI ? 'Ghi nhận đóng góp vào mục tiêu' : 'Log a contribution to this goal'}
          style={{ minWidth: 44, minHeight: 44, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
        >
          {/* Tinted chip so it reads as a discrete "add money" action (not a bare
              "+" that could be mistaken for "add goal"), matching the Saved/Buy pills. */}
          <span style={{ width: 28, height: 28, borderRadius: 999, background: 'var(--c-pos-tint)', color: 'var(--c-pos)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Plus size={16} strokeWidth={2.4} />
          </span>
        </button>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={isVI ? 'Mở/đóng mục tiêu' : 'Toggle goal'}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', color: 'var(--c-muted)', padding: 0, flexShrink: 0 }}
        >
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      {open && entry.items.map((item, i) => (
        <GoalItemRow
          key={i}
          item={item}
          isVI={isVI}
          onSkip={() => onRecSkip(item)}
          onRestore={() => onRecRestore(item)}
          onOverride={() => onRecOverride(item)}
          onEdit={() => onRecEdit(item)}
          onRecordBuy={() => onRecordBuy(item)}
          onRecordDeposit={() => onRecordDeposit(item)}
          onDcaSkip={() => onDcaSkip(item)}
          onDcaRestore={() => onDcaRestore(item)}
        />
      ))}
    </div>
  )
}

// ─── GoalItemRow — one allocation under a goal (recurring savings get a kebab) ──

function GoalItemRow({ item, isVI, onSkip, onRestore, onOverride, onEdit, onRecordBuy, onRecordDeposit, onDcaSkip, onDcaRestore }: {
  item: GoalItem; isVI: boolean
  onSkip: () => void; onRestore: () => void; onOverride: () => void; onEdit: () => void
  onRecordBuy: () => void; onRecordDeposit: () => void; onDcaSkip: () => void; onDcaRestore: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  useCloseOnScroll(menuOpen, () => setMenuOpen(false))
  const skipped = !!item.skipped
  const recorded = !!item.recorded

  const sublabel = goalItemSublabel(item, isVI)

  function openMenu() {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    }
    setMenuOpen(true)
  }

  return (
    <div style={{
      padding: '8px 14px 8px 56px', display: 'flex', alignItems: 'center', gap: 8,
      borderTop: '1px solid var(--c-line)', background: 'var(--c-card)', opacity: skipped ? 0.55 : 1,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--c-ink)', textDecoration: skipped ? 'line-through' : 'none' }}>
          {item.name}
        </div>
        <div style={{ fontSize: 10, color: item.overridden ? 'var(--c-navy)' : recorded ? 'var(--c-pos)' : 'var(--c-muted)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
          {sublabel}
          {item.isDCA && (
            <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'var(--c-navy-tint)', color: 'var(--c-navy)', fontWeight: 600 }}>DCA</span>
          )}
          <LinkLostBadge item={item} isVI={isVI} />
        </div>
      </div>
      <span style={{ fontSize: 12, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: 'var(--c-muted)', textDecoration: skipped ? 'line-through' : 'none' }}>
        {fmt(item.amount)}
      </span>
      {item.isRecurring ? (
        <>
          {recorded ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--c-pos)', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
              <Check size={13} />{isVI ? 'Đã gửi' : 'Saved'}
            </span>
          ) : !skipped && (
            <button onClick={onRecordDeposit} aria-label={isVI ? 'Ghi nhận đã gửi' : 'Record deposit'} style={{ padding: '4px 9px', fontSize: 11, fontWeight: 600, color: 'var(--c-pos)', background: 'var(--c-pos-tint)', border: '1px solid transparent', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0, whiteSpace: 'nowrap' }}>
              <Plus size={12} strokeWidth={2.4} />{isVI ? 'Đã gửi' : 'Saved'}
            </button>
          )}
          <button ref={btnRef} onClick={() => (menuOpen ? setMenuOpen(false) : openMenu())} aria-label="Saving actions" aria-haspopup="menu" aria-expanded={menuOpen} style={{ minWidth: 44, minHeight: 44, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, color: 'var(--c-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <>
              <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 5 }} />
              <div role="menu" style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 6, background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 8, boxShadow: '0 6px 20px rgba(15,23,42,0.12)', minWidth: 200, overflow: 'hidden' }}>
                {skipped ? (
                  <MenuItem icon={<Check size={13} />} label={isVI ? 'Bao gồm tháng này' : 'Include this month'} onClick={() => { onRestore(); setMenuOpen(false) }} noBorder />
                ) : (
                  <>
                    <MenuItem icon={<Plus size={13} />} label={isVI ? 'Ghi nhận đã gửi tháng này' : 'Record deposit this month'} onClick={() => { onRecordDeposit(); setMenuOpen(false) }} />
                    <MenuItem icon={<TrendingUp size={13} />} label={isVI ? 'Tiết kiệm thêm tháng này' : 'Save more this month'} onClick={() => { onOverride(); setMenuOpen(false) }} />
                    <MenuItem icon={<EditIcon size={13} />} label={isVI ? 'Sửa kế hoạch định kỳ' : 'Edit recurring plan'} onClick={() => { onEdit(); setMenuOpen(false) }} />
                    {item.overridden && <MenuItem icon={<RefreshCw size={13} />} label={isVI ? 'Khôi phục mặc định' : 'Restore default'} onClick={() => { onRestore(); setMenuOpen(false) }} />}
                    <MenuItem icon={<X size={13} />} label={isVI ? 'Bỏ qua tháng này' : 'Skip this month'} onClick={() => { onSkip(); setMenuOpen(false) }} danger noBorder />
                  </>
                )}
              </div>
            </>
          )}
        </>
      ) : item.isFundDca && skipped ? (
        <button onClick={onDcaRestore} aria-label="Restore DCA" style={{ padding: '4px 9px', fontSize: 11, fontWeight: 600, color: 'var(--c-muted)', background: 'transparent', border: '1px solid var(--c-line)', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
          <Check size={12} />{isVI ? 'Khôi phục' : 'Restore'}
        </button>
      ) : item.isFundDca && recorded ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--c-pos)', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
          <Check size={13} />{isVI ? 'Đã mua' : 'Bought'}
        </span>
      ) : item.isFundDca ? (
        <>
          <button onClick={onRecordBuy} aria-label={isVI ? 'Ghi nhận mua' : 'Record buy'} style={{ padding: '4px 9px', fontSize: 11, fontWeight: 600, color: 'var(--c-pos)', background: 'var(--c-pos-tint)', border: '1px solid transparent', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0, whiteSpace: 'nowrap' }}>
            <Plus size={12} strokeWidth={2.4} />{isVI ? 'Mua' : 'Buy'}
          </button>
          <button ref={btnRef} onClick={() => (menuOpen ? setMenuOpen(false) : openMenu())} aria-label="DCA actions" aria-haspopup="menu" aria-expanded={menuOpen} style={{ minWidth: 44, minHeight: 44, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, color: 'var(--c-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <>
              <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 5 }} />
              <div role="menu" style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 6, background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 8, boxShadow: '0 6px 20px rgba(15,23,42,0.12)', minWidth: 200, overflow: 'hidden' }}>
                <MenuItem icon={<Plus size={13} />} label={isVI ? 'Ghi nhận mua tháng này' : 'Record buy this month'} onClick={() => { onRecordBuy(); setMenuOpen(false) }} />
                <MenuItem icon={<X size={13} />} label={isVI ? 'Bỏ qua tháng này' : 'Skip this month'} onClick={() => { onDcaSkip(); setMenuOpen(false) }} danger noBorder />
              </div>
            </>
          )}
        </>
      ) : null}
    </div>
  )
}

// ─── PlanLineItem (with kebab menu) ───────────────────────────────────────────

export function PlanLineItem({
  primary, secondary, amount, muted, overridden, last, isVI,
  onSkip, onRestore, onOverride,
}: {
  primary: string
  secondary?: string | null
  amount: number
  muted?: boolean
  overridden?: boolean
  last?: boolean
  isVI: boolean
  onSkip?: () => void
  onRestore?: () => void
  onOverride?: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  useCloseOnScroll(menuOpen, () => setMenuOpen(false))

  function openMenu() {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
    }
    setMenuOpen(true)
  }

  return (
    <div style={{
      padding: '10px 14px 10px 60px', display: 'flex', alignItems: 'center', gap: 8,
      borderBottom: last ? 'none' : '1px solid var(--c-line)',
    }}>
      <div style={{ flex: 1, minWidth: 0, opacity: muted ? 0.55 : 1 }}>
        <div style={{
          fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          textDecoration: muted ? 'line-through' : 'none', color: 'var(--c-ink)',
        }}>
          {primary}
        </div>
        {secondary && (
          <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 1 }}>{secondary}</div>
        )}
      </div>
      <span style={{
        fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
        color: muted ? 'var(--c-muted)' : 'var(--c-ink)',
        textDecoration: muted ? 'line-through' : 'none',
        opacity: muted ? 0.55 : 1,
      }}>
        {fmt(muted ? 0 : amount)}
      </span>
      {/* Kebab menu — dropdown uses position:fixed to escape overflow:hidden on BudgetSection */}
      <button
        ref={btnRef}
        onClick={() => menuOpen ? setMenuOpen(false) : openMenu()}
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        style={{ minWidth: 44, minHeight: 44, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <MoreHorizontal size={14} color="var(--c-muted)" />
      </button>
      {menuOpen && (
        <>
          <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
          <div role="menu" style={{
            position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 51,
            background: 'var(--c-card)', border: '1px solid var(--c-line)',
            borderRadius: 8, boxShadow: 'var(--shadow-pop)',
            minWidth: 170, overflow: 'hidden',
          }}>
            {muted ? (
              <button
                role="menuitem"
                onClick={() => { onRestore?.(); setMenuOpen(false) }}
                style={{ width: '100%', textAlign: 'left', padding: '10px 12px', fontSize: 12, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--c-ink)', display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <Check size={14} color="var(--c-muted)" />
                {isVI ? 'Bao gồm tháng này' : 'Include this month'}
              </button>
            ) : (
              <>
                <button
                  role="menuitem"
                  onClick={() => { onOverride?.(); setMenuOpen(false) }}
                  style={{ width: '100%', textAlign: 'left', padding: '10px 12px', fontSize: 12, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--c-ink)', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--c-line)' }}
                >
                  <EditIcon size={14} color="var(--c-muted)" />
                  {isVI ? 'Ghi đè số tiền' : 'Override amount'}
                </button>
                {overridden && onRestore && (
                  <button
                    role="menuitem"
                    onClick={() => { onRestore(); setMenuOpen(false) }}
                    style={{ width: '100%', textAlign: 'left', padding: '10px 12px', fontSize: 12, background: 'transparent', border: 'none', borderBottom: '1px solid var(--c-line)', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--c-ink)', display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    <RefreshCw size={14} color="var(--c-muted)" />
                    {isVI ? 'Khôi phục mặc định' : 'Restore default'}
                  </button>
                )}
                <button
                  role="menuitem"
                  onClick={() => { onSkip?.(); setMenuOpen(false) }}
                  style={{ width: '100%', textAlign: 'left', padding: '10px 12px', fontSize: 12, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--c-neg)', display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  <X size={14} color="var(--c-neg)" />
                  {isVI ? 'Bỏ qua tháng này' : 'Skip this month'}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ─── MenuItem — popover row used by the recurring-saving kebab ────────────────

function MenuItem({ icon, label, onClick, danger, noBorder }: {
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; noBorder?: boolean
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      style={{ width: '100%', textAlign: 'left', padding: '10px 12px', fontSize: 12, background: 'transparent', border: 'none', borderBottom: noBorder ? 'none' : '1px solid var(--c-line)', cursor: 'pointer', fontFamily: 'inherit', color: danger ? 'var(--c-neg)' : 'var(--c-ink)', display: 'flex', alignItems: 'center', gap: 8 }}
    >
      <span style={{ color: danger ? 'var(--c-neg)' : 'var(--c-muted)', display: 'flex' }}>{icon}</span>
      {label}
    </button>
  )
}
