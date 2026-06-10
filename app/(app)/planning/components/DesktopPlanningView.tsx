'use client'

import React, { useState, useMemo, useRef } from 'react'
import {
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Target, Shield, ShoppingCart,
  MoreHorizontal, Check, RefreshCw, X, Plus, Settings, TrendingUp,
} from 'lucide-react'
import { useLocale } from 'next-intl'
import { fmt, fmtCompact } from '@/lib/formatters'
import FixedExpenseManager from './FixedExpenseManager'
import RecurringSavingManager from './RecurringSavingManager'
import AddTransactionSheet, { type EditableTransaction, type PrefillTransaction } from '@/app/assets/components/AddTransactionSheet'
import { buildByGoal, resolveRecurringSavings, type GoalItem } from '@/lib/planning'
import type {
  MonthlyPlan, FundInvestment, DirectSaving, FixedExpense,
  InsuranceMember, OtherExpense, RecurringSaving, RecurringSavingOverride, DcaSkip, Fund, Goal,
} from '../PlanningClient'

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function getFixedTotal(fixedExpenses: FixedExpense[]) {
  return fixedExpenses.reduce((s, e) => {
    if (e.override === 0) return s
    return s + (e.override ?? e.amount_vnd)
  }, 0)
}

function getInsTotal(insuranceMembers: InsuranceMember[]) {
  return insuranceMembers.reduce((s, m) => {
    if (m.excluded) return s
    return s + (m.monthlyOverride ?? Math.round(m.annual_payment_vnd / 12))
  }, 0)
}

const SHORT_MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const SHORT_MONTHS_VI = ['Th1','Th2','Th3','Th4','Th5','Th6','Th7','Th8','Th9','Th10','Th11','Th12']
const LONG_MONTHS_EN  = ['January','February','March','April','May','June','July','August','September','October','November','December']
const LONG_MONTHS_VI  = ['Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6','Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12']

// ─── DModal ───────────────────────────────────────────────────────────────────

function DModal({ onClose, title, width = 400, children }: {
  onClose: () => void; title: string; width?: number; children: React.ReactNode
}) {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, backdropFilter: 'blur(2px)', animation: 'fade-in 150ms ease' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: width, maxHeight: 'calc(100vh - 48px)', background: 'var(--c-card)', borderRadius: 16, boxShadow: '0 24px 48px rgba(15,23,42,0.18), 0 8px 16px rgba(15,23,42,0.08)', display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'modal-in 200ms cubic-bezier(0.2,0.8,0.2,1)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px 14px', borderBottom: '1px solid var(--c-line)', flexShrink: 0 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>{title}</h3>
          <button onClick={onClose} aria-label="Close" style={{ padding: 6, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, color: 'var(--c-muted)', display: 'flex' }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ flex: 1, padding: '18px 20px', overflowY: 'auto' }}>{children}</div>
      </div>
    </div>
  )
}

// ─── PlanTable — collapsible section ─────────────────────────────────────────

function PlanTable({ icon, iconColor, title, total, defaultOpen = true, action, children }: {
  icon: React.ReactNode; iconColor: string; title: string; total: number
  defaultOpen?: boolean; action?: React.ReactNode; children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const toggle = () => setOpen(o => !o)
  return (
    <div style={{ background: 'var(--c-card)', borderRadius: 16, border: '1px solid var(--c-line)', boxShadow: 'var(--shadow-card)', overflow: 'hidden', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderBottom: open ? '1px solid var(--c-line)' : 'none' }}>
        <button
          onClick={toggle}
          style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 'none', cursor: 'pointer', background: 'transparent', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 12, padding: 0 }}
        >
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--c-card-2)', color: iconColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {icon}
          </div>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-ink)', flex: 1 }}>{title}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmt(total)}</span>
        </button>
        {action}
        <button onClick={toggle} aria-label="Toggle section" style={{ border: 'none', cursor: 'pointer', background: 'transparent', display: 'flex', color: 'var(--c-muted)', padding: 0 }}>
          {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </div>
      {open && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          {children}
        </table>
      )}
    </div>
  )
}

// ─── Table header row ─────────────────────────────────────────────────────────

function THead({ col1, col2 }: { col1: string; col2: string }) {
  return (
    <thead>
      <tr style={{ background: 'var(--c-card-2)', borderBottom: '1px solid var(--c-line)' }}>
        <th style={{ padding: '8px 16px', textAlign: 'left', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: 'var(--c-muted)' }}>{col1}</th>
        <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: 'var(--c-muted)' }}>{col2}</th>
        <th style={{ width: 40 }} />
      </tr>
    </thead>
  )
}

function EditIcon({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4l10-10-4-4L4 16z" /></svg>
}
function TrashIcon({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
}

// ─── DPlanRow — table row with kebab menu ────────────────────────────────────

function MenuBtn({ icon, label, onClick, danger, noBorder }: {
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; noBorder?: boolean
}) {
  return (
    <button onClick={onClick} style={{ width: '100%', textAlign: 'left', padding: '10px 12px', fontSize: 12, background: 'transparent', border: 'none', borderBottom: noBorder ? 'none' : '1px solid var(--c-line)', cursor: 'pointer', fontFamily: 'inherit', color: danger ? 'var(--c-neg)' : 'var(--c-ink)', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ color: danger ? 'var(--c-neg)' : 'var(--c-muted)' }}>{icon}</span>
      {label}
    </button>
  )
}

function DPlanRow({ primary, secondary, amount, muted, last, isVI, onSkip, onRestore, onOverride }: {
  primary: string; secondary?: string | null; amount: number; muted?: boolean
  last?: boolean; isVI: boolean; onSkip?: () => void; onRestore?: () => void; onOverride?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)

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
      <td style={{ padding: '11px 12px', textAlign: 'right', verticalAlign: 'middle' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: muted ? 'var(--c-muted)' : 'var(--c-ink)', textDecoration: muted ? 'line-through' : 'none', fontVariantNumeric: 'tabular-nums' }}>
          {fmt(amount)}
        </span>
      </td>
      <td style={{ padding: '11px 8px 11px 4px', textAlign: 'right', verticalAlign: 'middle', width: 36 }}>
        <button ref={btnRef} onClick={() => open ? setOpen(false) : openMenu()} aria-label="More options" style={{ padding: 5, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, color: 'var(--c-muted)', display: 'flex' }}>
          <MoreHorizontal size={14} />
        </button>
        {open && (
          <>
            <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 5 }} />
            <div style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 6, background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 8, boxShadow: '0 6px 20px rgba(15,23,42,0.12)', minWidth: 170, overflow: 'hidden' }}>
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

function DGoalItemRow({ item, isVI, onSkip, onRestore, onOverride, onEdit, onRecordBuy, onRecordDeposit, onDcaSkip, onDcaRestore }: {
  item: GoalItem; isVI: boolean
  onSkip: () => void; onRestore: () => void; onOverride: () => void; onEdit: () => void
  onRecordBuy: () => void; onRecordDeposit: () => void; onDcaSkip: () => void; onDcaRestore: () => void
}) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const skipped = !!item.skipped
  const recorded = !!item.recorded

  const sublabel = skipped
    ? (isVI ? 'Bỏ qua tháng này' : 'Skipped this month')
    : item.overridden
      ? (isVI ? 'Đã ghi đè tháng này' : 'Overridden this month')
      : recorded
        ? (isVI ? 'Đã mua' : 'Recorded')
        : item.type === 'fund'
          ? 'Fund'
          : item.isRecurring ? (isVI ? 'Tiết kiệm định kỳ' : 'Recurring saving') : (isVI ? 'Tiết kiệm' : 'Direct saving')

  function openMenu() {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
    }
    setOpen(true)
  }

  return (
    <tr style={{ borderBottom: '1px solid var(--c-line)', background: 'var(--c-card)', opacity: skipped ? 0.5 : 1 }}>
      <td style={{ padding: '9px 16px 9px 44px', verticalAlign: 'middle' }}>
        <div style={{ fontSize: 12, fontWeight: 500, textDecoration: skipped ? 'line-through' : 'none' }}>{item.name}</div>
        <div style={{ fontSize: 10, color: item.overridden ? 'var(--c-navy)' : recorded ? 'var(--c-pos)' : 'var(--c-muted)', marginTop: 1 }}>
          {sublabel}
          {item.isDCA && <span style={{ marginLeft: 6, padding: '1px 5px', borderRadius: 4, background: 'var(--c-navy-tint)', color: 'var(--c-navy)', fontSize: 9, fontWeight: 700 }}>DCA</span>}
        </div>
      </td>
      <td style={{ padding: '9px 12px', textAlign: 'right', verticalAlign: 'middle' }}>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--c-muted)', fontVariantNumeric: 'tabular-nums', textDecoration: skipped ? 'line-through' : 'none' }}>{fmt(item.amount)}</span>
      </td>
      <td style={{ padding: '9px 8px 9px 4px', textAlign: 'right', verticalAlign: 'middle', width: 96 }}>
        {item.isRecurring ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
            {!skipped && (
              <button onClick={onRecordDeposit} aria-label={isVI ? 'Ghi nhận đã gửi' : 'Record deposit'} title={isVI ? 'Ghi nhận đã gửi — số tiền, ngày' : 'Record deposit — amount, date'}
                style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, color: 'var(--c-pos)', background: 'var(--c-pos-tint)', border: '1px solid transparent', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                <Plus size={12} strokeWidth={2.4} />{isVI ? 'Đã gửi' : 'Saved'}
              </button>
            )}
            <button ref={btnRef} onClick={() => open ? setOpen(false) : openMenu()} aria-label="Saving actions" style={{ padding: 5, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, color: 'var(--c-muted)', display: 'flex' }}>
              <MoreHorizontal size={14} />
            </button>
            {open && (
              <>
                <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 5 }} />
                <div style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 6, background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 8, boxShadow: '0 6px 20px rgba(15,23,42,0.12)', minWidth: 200, overflow: 'hidden' }}>
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
            <button ref={btnRef} onClick={() => open ? setOpen(false) : openMenu()} aria-label="DCA actions" style={{ padding: 5, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, color: 'var(--c-muted)', display: 'flex' }}>
              <MoreHorizontal size={14} />
            </button>
            {open && (
              <>
                <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 5 }} />
                <div style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 6, background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 8, boxShadow: '0 6px 20px rgba(15,23,42,0.12)', minWidth: 200, overflow: 'hidden' }}>
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

function StackedBar({ segments, total }: { segments: { color: string; value: number }[]; total: number }) {
  if (total <= 0) return <div style={{ height: 8, borderRadius: 999, background: 'rgba(255,255,255,0.15)' }} />
  return (
    <div style={{ height: 8, borderRadius: 999, display: 'flex', overflow: 'hidden' }}>
      {segments.map((s, i) => (
        <div key={i} style={{ width: `${Math.min(100, (s.value / total) * 100)}%`, background: s.color, flexShrink: 0 }} />
      ))}
    </div>
  )
}

// ─── Allocation card (navy sidebar) ──────────────────────────────────────────

function AllocationCard({ salary, totalGoalAmount, fixedTotal, insTotal, otherTotal, contributedTotal, isVI }: {
  salary: number; totalGoalAmount: number; fixedTotal: number; insTotal: number; otherTotal: number; contributedTotal: number; isVI: boolean
}) {
  const totalAllocated = totalGoalAmount + fixedTotal + insTotal + otherTotal
  const remaining = salary - totalAllocated
  const pct = (v: number) => salary > 0 ? `${Math.round(v / salary * 100)}%` : '—'

  const rows = [
    { l: isVI ? 'Đầu tư & tiết kiệm' : 'Invest & save', v: totalGoalAmount, c: 'var(--c-accent-fund,#2563eb)' },
    ...(fixedTotal > 0 ? [{ l: isVI ? 'Chi phí cố định' : 'Fixed expenses', v: fixedTotal, c: 'var(--c-accent-fixed,#b45309)' }] : []),
    ...(insTotal > 0   ? [{ l: isVI ? 'Bảo hiểm' : 'Insurance',      v: insTotal,  c: 'var(--c-accent-insurance,#7c3aed)' }] : []),
    ...(otherTotal > 0 ? [{ l: isVI ? 'Khoản khác' : 'Other',         v: otherTotal,c: 'var(--c-accent-other,#475569)' }] : []),
  ]

  return (
    <div data-testid="planning-alloc-card" style={{ padding: '18px 20px', background: 'var(--c-btn-primary)', color: '#fff', borderRadius: 16, boxShadow: 'var(--shadow-card)' }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)', marginBottom: 4 }}>
        {isVI ? 'Phân bổ tháng này' : "This month's allocation"}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>
        {fmtCompact(totalAllocated)}
      </div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>
        {pct(totalAllocated)} {isVI ? 'thu nhập' : 'of income'}
        {remaining < 0 && <span style={{ color: '#fca5a5', marginLeft: 8 }}>⚠ {isVI ? 'Vượt ngân sách' : 'Over budget'}</span>}
      </div>
      <div style={{ marginTop: 14, padding: 2, background: 'rgba(255,255,255,0.08)', borderRadius: 999 }}>
        <StackedBar segments={rows.map(r => ({ color: r.c, value: r.v }))} total={salary} />
      </div>
      <div style={{ marginTop: 14, display: 'grid', gap: 7 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: r.c, flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.l}</span>
            <span style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtCompact(r.v)}</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', minWidth: 30, textAlign: 'right', flexShrink: 0 }}>{pct(r.v)}</span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.12)', marginTop: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: remaining >= 0 ? 'rgba(255,255,255,0.25)' : '#fca5a5', flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: remaining >= 0 ? 'rgba(255,255,255,0.8)' : '#fca5a5' }}>
            {isVI ? 'Còn lại' : 'Remaining'}
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, color: remaining >= 0 ? '#86efac' : '#fca5a5', fontVariantNumeric: 'tabular-nums' }}>
            {remaining >= 0 ? '+' : ''}{fmtCompact(remaining)}
          </span>
        </div>
      </div>

      {totalGoalAmount > 0 && (
        <div data-testid="planning-contributed" style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.12)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>{isVI ? 'Đã góp tháng này' : 'Contributed this month'}</span>
            <span style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {fmtCompact(contributedTotal)} <span style={{ color: 'rgba(255,255,255,0.45)' }}>/ {fmtCompact(totalGoalAmount)}</span>
            </span>
          </div>
          <div style={{ marginTop: 8, height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.min(100, totalGoalAmount > 0 ? Math.round(contributedTotal / totalGoalAmount * 100) : 0)}%`, background: '#86efac', borderRadius: 999, transition: 'width 200ms' }} />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Shared button style ──────────────────────────────────────────────────────

const btnBase: React.CSSProperties = {
  border: 'none', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 10,
  fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
}

// ─── Label style ──────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, letterSpacing: '0.05em',
  textTransform: 'uppercase', color: 'var(--c-muted)',
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  month: number
  year: number
  plan: MonthlyPlan | null
  investments: FundInvestment[]
  savings: DirectSaving[]
  fixedExpenses: FixedExpense[]
  insuranceMembers: InsuranceMember[]
  otherExpenses: OtherExpense[]
  recurringSavings: RecurringSaving[]
  recurringSavingOverrides: RecurringSavingOverride[]
  dcaSkips: DcaSkip[]
  funds: Fund[]
  goals: Goal[]
  loading: boolean
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  onPlanCreated: (p: MonthlyPlan) => void
  onPlanDeleted: () => void
  onRefresh: () => void
  onToast: (msg: string) => void
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DesktopPlanningView({
  month, year, plan, investments, savings, fixedExpenses, insuranceMembers,
  otherExpenses, recurringSavings, recurringSavingOverrides, dcaSkips, funds, goals, loading,
  onPrev, onNext, onToday, onPlanCreated, onPlanDeleted, onRefresh, onToast,
}: Props) {
  const locale = useLocale()
  const isVI = locale === 'vi'

  // ── Modal state ──
  const [showIncome, setShowIncome] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [overrideModal, setOverrideModal] = useState<{ id: string; name: string; defaultAmount: number; type: 'fe' | 'ins' | 'rec' } | null>(null)
  const [overrideVal, setOverrideVal] = useState('')
  const [incomeVal, setIncomeVal] = useState('')
  const [saving, setSaving] = useState(false)
  const [otherModal, setOtherModal] = useState<OtherExpense | Record<string, never> | null>(null)
  const [otherDesc, setOtherDesc] = useState('')
  const [otherAmt, setOtherAmt] = useState('')
  const [showFEManage, setShowFEManage] = useState(false)
  const [showRSManage, setShowRSManage] = useState(false)
  // Recording a DCA buy opens the canonical Add-Transaction sheet in edit mode,
  // pre-filled from the planned investment. Saving completes the same planned
  // row (PUT), so it never double-counts against the goal.
  const [buyEdit, setBuyEdit] = useState<EditableTransaction | null>(null)
  // Logging a contribution from a goal header, or recording a recurring bank
  // deposit, opens the same sheet in create mode (POST) pre-filled with the goal.
  const [prefillTx, setPrefillTx] = useState<PrefillTransaction | null>(null)

  // ── Derived values ──
  const goalsById = useMemo(() => new Map(goals.map(g => [g.goal_id, g.goal_name])), [goals])
  const resolvedRecurring = useMemo(
    () => resolveRecurringSavings(recurringSavings, recurringSavingOverrides),
    [recurringSavings, recurringSavingOverrides],
  )
  // Skipped DCA funds are no longer seeded as rows, so synthesize struck-through
  // lines from the fund config + the plan's skip list.
  const skippedDcaInvestments = useMemo(() => {
    const skipped = new Set(dcaSkips.map(s => s.fund_id))
    return funds
      .filter(f => f.is_dca && f.dca_monthly_amount_vnd && skipped.has(f.id))
      .map(f => ({
        goal_id: f.dca_goal_id ?? null,
        amount_vnd: f.dca_monthly_amount_vnd as number,
        is_dca_seeded: true,
        skipped: true,
        fund_id: f.id,
        funds: { name: f.name },
      }))
  }, [funds, dcaSkips])
  const byGoal = useMemo(
    () => buildByGoal([...investments, ...skippedDcaInvestments], savings, resolvedRecurring, goalsById, {
      unallocated: isVI ? 'Chưa phân bổ' : 'Unallocated',
    }),
    [investments, skippedDcaInvestments, savings, resolvedRecurring, goalsById, isVI],
  )
  const totalGoalAmount = byGoal.reduce((s, g) => s + g.totalAllocated, 0)
  const contributedTotal = byGoal.reduce((s, g) => s + g.contributed, 0)
  const fixedTotal = useMemo(() => getFixedTotal(fixedExpenses), [fixedExpenses])
  const insTotal   = useMemo(() => getInsTotal(insuranceMembers), [insuranceMembers])
  const otherTotal = otherExpenses.reduce((s, o) => s + o.amount_vnd, 0)
  const totalOutflow = totalGoalAmount + fixedTotal + insTotal + otherTotal
  const remaining    = plan ? plan.salary_vnd - totalOutflow : 0
  const savedPct     = plan && plan.salary_vnd > 0 ? Math.round(totalGoalAmount / plan.salary_vnd * 100) : 0

  const shortMonths = isVI ? SHORT_MONTHS_VI : SHORT_MONTHS_EN
  const longMonths  = isVI ? LONG_MONTHS_VI  : LONG_MONTHS_EN
  const monthLabel  = `${longMonths[month - 1]} ${year}`
  const shortLabel  = `${shortMonths[month - 1]} ${year}`

  // ── API handlers ──

  async function handleSetIncome() {
    const num = Number(incomeVal)
    if (!incomeVal || isNaN(num) || num <= 0) return
    setSaving(true)
    try {
      if (plan) {
        const res = await fetch(`/api/v1/monthly-plans/${plan.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ salary_vnd: num }),
        })
        if (res.ok) { setShowIncome(false); onRefresh(); onToast(isVI ? 'Đã cập nhật thu nhập' : 'Income updated') }
      } else {
        const res = await fetch('/api/v1/monthly-plans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ month, year, salary_vnd: num }),
        })
        if (res.ok) {
          const p = await res.json()
          setShowIncome(false)
          onPlanCreated({ id: p.id, month: p.month, year: p.year, salary_vnd: p.salary_vnd })
        }
      }
    } finally { setSaving(false) }
  }

  async function handleDeletePlan() {
    if (!plan) return
    setSaving(true)
    try {
      await fetch(`/api/v1/monthly-plans/${plan.id}`, { method: 'DELETE' })
      setShowDelete(false)
      onPlanDeleted()
      onToast(isVI ? `Đã xoá kế hoạch ${monthLabel}` : `Plan for ${monthLabel} deleted`)
    } finally { setSaving(false) }
  }

  async function handleFESkip(fe: FixedExpense) {
    if (!plan) return
    await fetch(`/api/v1/monthly-plans/${plan.id}/fixed-expense-overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixed_expense_id: fe.expense_id, monthly_amount_override_vnd: 0 }),
    })
    onRefresh(); onToast(isVI ? `Đã bỏ qua ${fe.expense_name}` : `Skipped ${fe.expense_name}`)
  }

  async function handleFERestore(fe: FixedExpense) {
    if (!plan) return
    const res = await fetch(`/api/v1/monthly-plans/${plan.id}/fixed-expense-overrides`)
    if (!res.ok) return
    const overrides: Array<{ id: string; fixed_expense_id: string }> = await res.json()
    const match = overrides.find(o => o.fixed_expense_id === fe.expense_id)
    if (match) await fetch(`/api/v1/monthly-plans/${plan.id}/fixed-expense-overrides/${match.id}`, { method: 'DELETE' })
    onRefresh(); onToast(isVI ? `Đã khôi phục ${fe.expense_name}` : `Restored ${fe.expense_name}`)
  }

  async function handleInsSkip(m: InsuranceMember) {
    if (!plan) return
    await fetch(`/api/v1/monthly-plans/${plan.id}/excluded-insurance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_id: m.member_id }),
    })
    onRefresh(); onToast(isVI ? `Đã bỏ qua ${m.member_name}` : `Skipped ${m.member_name}`)
  }

  async function handleInsRestore(m: InsuranceMember) {
    if (!plan) return
    await fetch(`/api/v1/monthly-plans/${plan.id}/excluded-insurance/${m.member_id}`, { method: 'DELETE' })
    const oRes = await fetch(`/api/v1/monthly-plans/${plan.id}/insurance-overrides`)
    if (oRes.ok) {
      const overrides: Array<{ id: string; member_id: string }> = await oRes.json()
      const match = overrides.find(o => o.member_id === m.member_id)
      if (match) await fetch(`/api/v1/monthly-plans/${plan.id}/insurance-overrides/${match.id}`, { method: 'DELETE' })
    }
    onRefresh(); onToast(isVI ? `Đã khôi phục ${m.member_name}` : `Restored ${m.member_name}`)
  }

  async function handleRecSkip(item: { recurringId?: string; name: string }) {
    if (!plan || !item.recurringId) return
    await fetch(`/api/v1/monthly-plans/${plan.id}/recurring-saving-overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recurring_saving_id: item.recurringId, monthly_amount_override_vnd: 0 }),
    })
    onRefresh(); onToast(isVI ? `Đã bỏ qua ${item.name}` : `Skipped ${item.name}`)
  }

  async function handleRecRestore(item: { recurringId?: string; name: string }) {
    if (!plan || !item.recurringId) return
    const res = await fetch(`/api/v1/monthly-plans/${plan.id}/recurring-saving-overrides`)
    if (!res.ok) return
    const overrides: Array<{ id: string; recurring_saving_id: string }> = await res.json()
    const match = overrides.find(o => o.recurring_saving_id === item.recurringId)
    if (match) await fetch(`/api/v1/monthly-plans/${plan.id}/recurring-saving-overrides/${match.id}`, { method: 'DELETE' })
    onRefresh(); onToast(isVI ? `Đã khôi phục ${item.name}` : `Restored ${item.name}`)
  }

  async function handleDcaSkip(item: { fundId?: string | null; name: string }) {
    if (!plan || !item.fundId) return
    await fetch(`/api/v1/monthly-plans/${plan.id}/dca-skips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fund_id: item.fundId }),
    })
    onRefresh(); onToast(isVI ? `Đã bỏ qua ${item.name}` : `Skipped ${item.name}`)
  }

  async function handleDcaRestore(item: { fundId?: string | null; name: string }) {
    if (!plan || !item.fundId) return
    await fetch(`/api/v1/monthly-plans/${plan.id}/dca-skips/${item.fundId}`, { method: 'DELETE' })
    onRefresh(); onToast(isVI ? `Đã khôi phục ${item.name}` : `Restored ${item.name}`)
  }

  function openBuy(transactionId?: string) {
    if (!transactionId) return
    const inv = investments.find(i => i.transaction_id === transactionId)
    if (!inv) return
    setBuyEdit({
      transaction_id: inv.transaction_id,
      asset_type: 'fund',
      investment_date: inv.investment_date ?? new Date().toISOString().slice(0, 10),
      amount_vnd: inv.amount_vnd,
      unit_price: inv.unit_price,
      units: inv.units,
      interest_rate: null,
      expiry_date: null,
      notes: null,
      fund_id: inv.fund_id,
      goal_id: inv.goal_id,
    })
  }

  // Open the Add-Transaction sheet in create mode, pre-filled toward a goal.
  // Used by the goal-header "+" (log any contribution) and the recurring-bank
  // "Saved" pill (record this month's deposit at the planned amount).
  function openContribution(g: { goalId: string; isUnallocated: boolean }, prefill?: Partial<PrefillTransaction>) {
    setPrefillTx({
      goal_id: g.isUnallocated ? null : g.goalId,
      investment_date: new Date().toISOString().slice(0, 10),
      ...prefill,
    })
  }

  async function handleSaveOverride() {
    if (!overrideModal || !plan) return
    const num = Number(overrideVal)
    if (!overrideVal || isNaN(num) || num <= 0) return
    setSaving(true)
    try {
      const url = overrideModal.type === 'fe'
        ? `/api/v1/monthly-plans/${plan.id}/fixed-expense-overrides`
        : overrideModal.type === 'rec'
          ? `/api/v1/monthly-plans/${plan.id}/recurring-saving-overrides`
          : `/api/v1/monthly-plans/${plan.id}/insurance-overrides`
      const body = overrideModal.type === 'fe'
        ? { fixed_expense_id: overrideModal.id, monthly_amount_override_vnd: num }
        : overrideModal.type === 'rec'
          ? { recurring_saving_id: overrideModal.id, monthly_amount_override_vnd: num }
          : { member_id: overrideModal.id, monthly_amount_override_vnd: num }
      await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      setOverrideModal(null)
      onRefresh(); onToast(isVI ? 'Đã lưu' : 'Saved')
    } finally { setSaving(false) }
  }

  function openOtherModal(o?: OtherExpense) {
    setOtherModal(o ?? {})
    setOtherDesc(o?.description ?? '')
    setOtherAmt(o ? String(o.amount_vnd) : '')
  }

  async function handleOtherSave() {
    if (!plan || !otherDesc.trim() || !otherAmt || Number(otherAmt) <= 0) return
    setSaving(true)
    try {
      const isEdit = otherModal && 'id' in otherModal && otherModal.id
      const url = isEdit
        ? `/api/v1/monthly-plans/${plan.id}/other-expenses/${(otherModal as OtherExpense).id}`
        : `/api/v1/monthly-plans/${plan.id}/other-expenses`
      await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: otherDesc.trim(), amount_vnd: Number(otherAmt) }),
      })
      setOtherModal(null)
      onRefresh()
      onToast(isVI ? 'Đã lưu' : 'Saved')
    } finally { setSaving(false) }
  }

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div
      data-testid="desktop-planning"
      className="hidden md:flex"
      style={{ flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}
    >
      {/* ── DTopBar ─────────────────────────────────────────────────────────── */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 28px 16px', flexShrink: 0, borderBottom: '1px solid var(--c-line)', background: 'var(--c-canvas)' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-muted)', marginBottom: 3 }}>
            {isVI ? 'Kế hoạch' : 'Planning'}
          </div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--c-ink)', lineHeight: 1.1 }}>
            {isVI ? 'Kế hoạch Tháng' : 'Monthly Plan'}
          </h1>
        </div>

        {/* Month picker */}
        <div
          data-testid="desktop-month-picker"
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: 3, background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 10 }}
        >
          <button
            data-testid="prev-month"
            onClick={onPrev}
            aria-label="Previous month"
            style={{ padding: '5px 8px', border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, color: 'var(--c-muted)', display: 'flex' }}
          >
            <ChevronLeft size={15} />
          </button>
          <button
            onClick={onToday}
            aria-label="Jump to current month"
            style={{ padding: '5px 14px', minWidth: 90, textAlign: 'center', background: 'var(--c-canvas)', border: '1px solid var(--c-line)', borderRadius: 7, fontSize: 13, fontWeight: 600, color: 'var(--c-ink)', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {shortLabel}
          </button>
          <button
            data-testid="next-month"
            onClick={onNext}
            aria-label="Next month"
            style={{ padding: '5px 8px', border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, color: 'var(--c-muted)', display: 'flex' }}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </header>

      {/* ── Two-panel body ───────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>

        {/* Left — main scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 40px', minWidth: 0 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--c-muted)' }}>
              {isVI ? 'Đang tải...' : 'Loading...'}
            </div>
          ) : !plan ? (
            /* Empty state */
            <div
              data-testid="planning-empty-state"
              style={{ padding: '60px 20px', textAlign: 'center', background: 'var(--c-card)', border: '1px dashed var(--c-line-strong)', borderRadius: 16, maxWidth: 480, margin: '0 auto' }}
            >
              <div style={{ width: 52, height: 52, borderRadius: 26, background: 'var(--c-card-2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14, color: 'var(--c-muted)' }}>
                <svg viewBox="0 0 24 24" width={24} height={24} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="5" width="18" height="16" rx="2" />
                  <path d="M3 9h18M8 3v4M16 3v4" />
                </svg>
              </div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                {isVI ? `Chưa có kế hoạch cho ${monthLabel}` : `No plan for ${monthLabel}`}
              </h3>
              <p style={{ margin: '6px 0 18px', fontSize: 13, color: 'var(--c-muted)' }}>
                {isVI ? 'Nhập thu nhập để bắt đầu phân bổ.' : 'Enter your income to start allocating.'}
              </p>
              <button
                onClick={() => { setIncomeVal(''); setShowIncome(true) }}
                className="cn-btn primary"
                style={{ padding: '10px 18px' }}
              >
                <Plus size={14} strokeWidth={2.4} />
                {isVI ? 'Thêm thu nhập' : 'Set income'}
              </button>
            </div>
          ) : (
            <>
              {/* Summary strip */}
              <div
                data-testid="planning-summary-strip"
                style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: 'var(--c-line)', borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}
              >
                {([
                  {
                    l: isVI ? 'Thu nhập' : 'Income',
                    v: plan.salary_vnd,
                    c: 'var(--c-ink)',
                    extra: (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => { setIncomeVal(String(plan.salary_vnd)); setShowIncome(true) }} aria-label="Edit income" style={{ padding: 6, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, color: 'var(--c-muted)', display: 'flex' }}>
                          <EditIcon size={15} />
                        </button>
                        <button onClick={() => setShowDelete(true)} aria-label="Delete plan" style={{ padding: 6, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, color: 'var(--c-neg)', display: 'flex' }}>
                          <TrashIcon size={15} />
                        </button>
                      </div>
                    ),
                  },
                  { l: isVI ? 'Tổng chi' : 'Outflow',    v: totalOutflow, c: 'var(--c-ink)' },
                  { l: isVI ? 'Còn lại'  : 'Remaining',  v: remaining,    c: remaining >= 0 ? 'var(--c-pos)' : 'var(--c-neg)' },
                  { l: isVI ? '% Tiết kiệm' : 'Saved %', v: null as number | null, c: 'var(--c-navy)', custom: `${savedPct}%` },
                ] as Array<{ l: string; v: number | null; c: string; custom?: string; extra?: React.ReactNode }>).map((k, i) => (
                  <div key={i} style={{ background: 'var(--c-card)', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--c-muted)' }}>{k.l}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: k.c, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                        {k.custom ?? fmtCompact(k.v!)}
                      </div>
                    </div>
                    {k.extra}
                  </div>
                ))}
              </div>

              {/* By goal */}
              <PlanTable
                icon={<Target size={15} />}
                iconColor="var(--c-navy)"
                title={isVI ? 'Theo mục tiêu' : 'By goal'}
                total={totalGoalAmount}
                action={
                  <button
                    data-testid="desktop-manage-savings"
                    onClick={() => setShowRSManage(true)}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', fontSize: 12, fontWeight: 600, color: 'var(--c-navy)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 8 }}
                  >
                    <Settings size={14} />
                    {isVI ? 'Quản lý tiết kiệm' : 'Manage savings'}
                  </button>
                }
              >
                <THead col1={isVI ? 'Mục tiêu / Khoản' : 'Goal / Allocation'} col2={isVI ? 'Tháng này' : 'This month'} />
                <tbody>
                  {byGoal.length === 0 ? (
                    <tr><td colSpan={3} style={{ padding: '16px', textAlign: 'center', color: 'var(--c-muted)', fontSize: 12 }}>{isVI ? 'Chưa có khoản đầu tư nào' : 'No investments yet'}</td></tr>
                  ) : byGoal.map(g => {
                    const pct = g.totalAllocated > 0 ? Math.min(100, Math.round(g.contributed / g.totalAllocated * 100)) : (g.contributed > 0 ? 100 : 0)
                    const met = g.totalAllocated > 0 && g.contributed >= g.totalAllocated
                    return (
                    <React.Fragment key={g.goalId}>
                      <tr style={{ background: 'var(--c-card-2)', borderBottom: '1px solid var(--c-line)' }}>
                        <td style={{ padding: '10px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--c-navy-tint)', color: 'var(--c-navy)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <Target size={12} />
                            </div>
                            <span style={{ fontSize: 13, fontWeight: 600 }}>{g.goalName}</span>
                            <span style={{ fontSize: 11, color: 'var(--c-muted)' }}>· {g.items.length} {isVI ? 'khoản' : g.items.length === 1 ? 'item' : 'items'}</span>
                          </div>
                          {g.totalAllocated > 0 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, paddingLeft: 32 }}>
                              <div style={{ flex: 1, maxWidth: 160, height: 4, borderRadius: 999, background: 'var(--c-line)', overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${pct}%`, background: met ? 'var(--c-pos)' : 'var(--c-navy)', borderRadius: 999, transition: 'width 200ms' }} />
                              </div>
                              <span style={{ fontSize: 10, color: 'var(--c-muted)', fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', verticalAlign: 'top' }}>
                          <div style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(g.totalAllocated)}</div>
                          <div style={{ fontSize: 10, color: g.contributed > 0 ? 'var(--c-pos)' : 'var(--c-muted)', marginTop: 2, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                            {g.contributed > 0 ? `${fmt(g.contributed)} ${isVI ? 'đã góp' : 'in'}` : (isVI ? 'Chưa góp' : 'Nothing yet')}
                          </div>
                        </td>
                        <td style={{ padding: '10px 12px 10px 4px', textAlign: 'right', verticalAlign: 'top', width: 40 }}>
                          <button
                            onClick={() => openContribution(g)}
                            aria-label={isVI ? 'Ghi nhận đóng góp' : 'Log contribution'}
                            title={isVI ? 'Ghi nhận đóng góp' : 'Log contribution'}
                            style={{ padding: 5, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, color: 'var(--c-pos)', display: 'flex', marginLeft: 'auto' }}
                          >
                            <Plus size={15} strokeWidth={2.4} />
                          </button>
                        </td>
                      </tr>
                      {g.items.map((inv, ii) => (
                        <DGoalItemRow
                          key={g.goalId + '-' + ii}
                          item={inv}
                          isVI={isVI}
                          onSkip={() => handleRecSkip(inv)}
                          onRestore={() => handleRecRestore(inv)}
                          onEdit={() => setShowRSManage(true)}
                          onOverride={() => {
                            setOverrideModal({ id: inv.recurringId!, name: inv.name, defaultAmount: inv.baseAmount ?? inv.amount, type: 'rec' })
                            setOverrideVal(String(inv.baseAmount ?? inv.amount))
                          }}
                          onRecordBuy={() => openBuy(inv.transactionId)}
                          onRecordDeposit={() => openContribution(g, { asset_type: 'bank', amount_vnd: inv.amount })}
                          onDcaSkip={() => handleDcaSkip(inv)}
                          onDcaRestore={() => handleDcaRestore(inv)}
                        />
                      ))}
                    </React.Fragment>
                    )
                  })}
                </tbody>
              </PlanTable>

              {/* Fixed expenses */}
              <PlanTable
                icon={<svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M9 8h2M13 8h2M9 12h2M13 12h2M9 16h2M13 16h2" /></svg>}
                iconColor="var(--c-accent-fixed,#b45309)"
                title={isVI ? 'Chi phí cố định' : 'Fixed expenses'}
                total={fixedTotal}
                action={
                  <button
                    data-testid="desktop-manage-fixed"
                    onClick={() => setShowFEManage(true)}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', fontSize: 12, fontWeight: 600, color: 'var(--c-navy)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 8 }}
                  >
                    <Settings size={14} />
                    {isVI ? 'Quản lý' : 'Manage'}
                  </button>
                }
              >
                <THead col1={isVI ? 'Chi phí' : 'Expense'} col2={isVI ? 'Số tiền' : 'Amount'} />
                <tbody>
                  {fixedExpenses.length === 0 ? (
                    <tr><td colSpan={3} style={{ padding: '16px', textAlign: 'center', color: 'var(--c-muted)', fontSize: 12 }}>{isVI ? 'Chưa có chi phí cố định' : 'No fixed expenses'}</td></tr>
                  ) : fixedExpenses.map((fe, i) => {
                    const skipped    = fe.override === 0
                    const isOverridden = !skipped && fe.override != null && fe.override !== fe.amount_vnd
                    const amount     = skipped ? 0 : (fe.override ?? fe.amount_vnd)
                    return (
                      <DPlanRow
                        key={fe.expense_id}
                        primary={fe.expense_name}
                        secondary={skipped ? (isVI ? 'Bỏ qua tháng này' : 'Skipped') : isOverridden ? (isVI ? '(đã ghi đè)' : '(overridden)') : null}
                        amount={amount}
                        muted={skipped}
                        last={i === fixedExpenses.length - 1}
                        isVI={isVI}
                        onSkip={() => handleFESkip(fe)}
                        onRestore={fe.override != null ? () => handleFERestore(fe) : undefined}
                        onOverride={() => { setOverrideModal({ id: fe.expense_id, name: fe.expense_name, defaultAmount: fe.amount_vnd, type: 'fe' }); setOverrideVal(String(fe.override ?? fe.amount_vnd)) }}
                      />
                    )
                  })}
                </tbody>
              </PlanTable>

              {/* Insurance */}
              <PlanTable icon={<Shield size={15} />} iconColor="var(--c-accent-insurance,#7c3aed)" title={isVI ? 'Bảo hiểm' : 'Insurance'} total={insTotal}>
                <THead col1={isVI ? 'Thành viên' : 'Member'} col2={isVI ? 'Đóng góp' : 'Contribution'} />
                <tbody>
                  {insuranceMembers.length === 0 ? (
                    <tr><td colSpan={3} style={{ padding: '16px', textAlign: 'center', color: 'var(--c-muted)', fontSize: 12 }}>{isVI ? 'Chưa có bảo hiểm' : 'No insurance members'}</td></tr>
                  ) : insuranceMembers.map((m, i) => {
                    const monthly    = m.monthlyOverride ?? Math.round(m.annual_payment_vnd / 12)
                    const isOverridden = !m.excluded && m.monthlyOverride != null
                    return (
                      <DPlanRow
                        key={m.member_id}
                        primary={m.member_name}
                        secondary={m.excluded ? (isVI ? 'Bỏ qua tháng này' : 'Skipped') : isOverridden ? (isVI ? '(đã ghi đè)' : '(overridden)') : (isVI ? 'Đóng góp tháng' : 'Monthly contribution')}
                        amount={m.excluded ? 0 : monthly}
                        muted={m.excluded}
                        last={i === insuranceMembers.length - 1}
                        isVI={isVI}
                        onSkip={() => handleInsSkip(m)}
                        onRestore={m.excluded || m.monthlyOverride != null ? () => handleInsRestore(m) : undefined}
                        onOverride={() => { const d = Math.round(m.annual_payment_vnd / 12); setOverrideModal({ id: m.member_id, name: m.member_name, defaultAmount: d, type: 'ins' }); setOverrideVal(String(m.monthlyOverride ?? d)) }}
                      />
                    )
                  })}
                </tbody>
              </PlanTable>

              {/* Other expenses */}
              <PlanTable icon={<ShoppingCart size={15} />} iconColor="var(--c-accent-other,#475569)" title={isVI ? 'Khoản khác' : 'Other'} total={otherTotal} defaultOpen={false}>
                <tbody>
                  {otherExpenses.map((o, i) => (
                    <tr key={o.id} style={{ borderBottom: i < otherExpenses.length - 1 ? '1px solid var(--c-line)' : 'none', background: 'var(--c-card)' }}>
                      <td style={{ padding: '10px 16px', fontSize: 13, fontWeight: 500 }}>{o.description}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmt(o.amount_vnd)}</span>
                      </td>
                      <td style={{ padding: '10px 8px 10px 4px', textAlign: 'right', width: 36 }}>
                        <button aria-label="Edit" onClick={() => openOtherModal(o)} style={{ padding: 5, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, color: 'var(--c-muted)', display: 'flex' }}>
                          <EditIcon size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  <tr style={{ background: 'var(--c-card)' }}>
                    <td colSpan={3} style={{ padding: '10px 16px' }}>
                      <button onClick={() => openOtherModal()} style={{ padding: '4px 0', fontSize: 12, color: 'var(--c-navy)', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 500 }}>
                        <Plus size={12} strokeWidth={2.4} />
                        {isVI ? 'Thêm khoản' : 'Add item'}
                      </button>
                    </td>
                  </tr>
                </tbody>
              </PlanTable>
            </>
          )}
        </div>

        {/* Right — allocation sidebar */}
        {plan && (
          <div style={{ width: 280, flexShrink: 0, overflowY: 'auto', padding: '20px 20px 40px 4px', borderLeft: '1px solid var(--c-line)' }}>
            <AllocationCard
              salary={plan.salary_vnd}
              totalGoalAmount={totalGoalAmount}
              fixedTotal={fixedTotal}
              insTotal={insTotal}
              otherTotal={otherTotal}
              contributedTotal={contributedTotal}
              isVI={isVI}
            />
          </div>
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}

      {showIncome && (
        <DModal
          onClose={() => setShowIncome(false)}
          title={plan ? (isVI ? 'Sửa thu nhập' : 'Edit income') : (isVI ? 'Thêm thu nhập' : 'Set income')}
          width={380}
        >
          <div style={{ display: 'grid', gap: 14 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={labelStyle}>{isVI ? 'Thu nhập tháng (₫)' : 'Monthly income (₫)'}</span>
              <input
                type="text"
                inputMode="numeric"
                value={incomeVal ? Number(incomeVal).toLocaleString('en-US') : ''}
                onChange={e => setIncomeVal(e.target.value.replace(/,/g, '').replace(/[^0-9]/g, ''))}
                autoFocus
                placeholder="e.g. 45,000,000"
                className="cn-input tabular"
              />
            </label>
            {incomeVal && Number(incomeVal) > 0 && (
              <div style={{ background: 'var(--c-navy-tint)', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: 'var(--c-navy)', fontVariantNumeric: 'tabular-nums' }}>
                {Math.round(Number(incomeVal)).toLocaleString('vi-VN')} ₫
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button onClick={() => setShowIncome(false)} style={{ ...btnBase, flex: 1, padding: '10px 14px', background: 'transparent', color: 'var(--c-ink)', border: '1px solid var(--c-line)' }}>{isVI ? 'Hủy' : 'Cancel'}</button>
              <button onClick={handleSetIncome} disabled={saving || !incomeVal || Number(incomeVal) <= 0} style={{ ...btnBase, flex: 2, padding: '10px 14px', background: 'var(--c-btn-primary)', color: '#fff', opacity: saving || !incomeVal || Number(incomeVal) <= 0 ? 0.6 : 1 }}>
                {saving ? (isVI ? 'Đang lưu...' : 'Saving...') : (isVI ? 'Lưu' : 'Save')}
              </button>
            </div>
          </div>
        </DModal>
      )}

      {showDelete && (
        <DModal onClose={() => setShowDelete(false)} title={isVI ? 'Xoá kế hoạch tháng?' : 'Delete monthly plan?'} width={400}>
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ padding: '12px 14px', background: 'var(--c-neg-tint,#fef2f2)', borderRadius: 10, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <X size={16} color="var(--c-neg)" strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 1 }} />
              <p style={{ margin: 0, fontSize: 13, color: 'var(--c-neg)', lineHeight: 1.5 }}>
                {isVI ? `Toàn bộ dữ liệu kế hoạch cho ${monthLabel} sẽ bị xoá vĩnh viễn.` : `All plan data for ${monthLabel} will be permanently deleted.`}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowDelete(false)} style={{ ...btnBase, flex: 1, padding: '10px 14px', background: 'transparent', color: 'var(--c-ink)', border: '1px solid var(--c-line)' }}>{isVI ? 'Huỷ' : 'Cancel'}</button>
              <button onClick={handleDeletePlan} disabled={saving} style={{ ...btnBase, flex: 2, padding: '10px 14px', background: 'var(--c-neg)', color: '#fff' }}>
                <TrashIcon size={14} />
                {saving ? (isVI ? 'Đang xoá...' : 'Deleting...') : (isVI ? 'Xoá kế hoạch' : 'Delete plan')}
              </button>
            </div>
          </div>
        </DModal>
      )}

      {overrideModal && (
        <DModal onClose={() => setOverrideModal(null)} title={isVI ? 'Ghi đè số tiền' : 'Override amount'} width={340}>
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ fontSize: 13, color: 'var(--c-muted)', fontWeight: 500 }}>{overrideModal.name}</div>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={labelStyle}>{isVI ? 'Số tiền tháng này (₫)' : 'Amount this month (₫)'}</span>
              <input type="text" inputMode="numeric" value={overrideVal ? Number(overrideVal).toLocaleString('en-US') : ''} onChange={e => setOverrideVal(e.target.value.replace(/,/g, '').replace(/[^0-9]/g, ''))} autoFocus className="cn-input tabular" />
            </label>
            {overrideVal && Number(overrideVal) > 0 && (
              <div style={{ background: 'var(--c-navy-tint)', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: 'var(--c-navy)', fontVariantNumeric: 'tabular-nums' }}>
                {Math.round(Number(overrideVal)).toLocaleString('vi-VN')} ₫
              </div>
            )}
            <button onClick={() => setOverrideVal(String(overrideModal.defaultAmount))} style={{ alignSelf: 'flex-start', fontSize: 11, padding: '4px 8px', background: 'transparent', border: '1px solid var(--c-line)', borderRadius: 6, color: 'var(--c-navy)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
              {isVI ? 'Mặc định' : 'Default'}: {fmtCompact(overrideModal.defaultAmount)}
            </button>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button onClick={() => setOverrideModal(null)} style={{ ...btnBase, flex: 1, padding: '10px 14px', background: 'transparent', color: 'var(--c-ink)', border: '1px solid var(--c-line)' }}>{isVI ? 'Hủy' : 'Cancel'}</button>
              <button onClick={handleSaveOverride} disabled={saving || !overrideVal || Number(overrideVal) <= 0} style={{ ...btnBase, flex: 2, padding: '10px 14px', background: 'var(--c-btn-primary)', color: '#fff', opacity: saving || !overrideVal || Number(overrideVal) <= 0 ? 0.6 : 1 }}>
                {saving ? (isVI ? 'Đang lưu...' : 'Saving...') : (isVI ? 'Lưu' : 'Save')}
              </button>
            </div>
          </div>
        </DModal>
      )}

      {otherModal !== null && (
        <DModal
          onClose={() => setOtherModal(null)}
          title={'id' in otherModal && otherModal.id ? (isVI ? 'Sửa khoản chi' : 'Edit expense') : (isVI ? 'Thêm khoản chi' : 'Add expense')}
          width={380}
        >
          <div style={{ display: 'grid', gap: 14 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={labelStyle}>{isVI ? 'Mô tả' : 'Description'}</span>
              <input value={otherDesc} onChange={e => setOtherDesc(e.target.value)} autoFocus placeholder={isVI ? 'VD. Mua laptop...' : 'e.g. Buy laptop...'} className="cn-input" />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={labelStyle}>{isVI ? 'Số tiền (₫)' : 'Amount (₫)'}</span>
              <input type="text" inputMode="numeric" value={otherAmt ? Number(otherAmt).toLocaleString('en-US') : ''} onChange={e => setOtherAmt(e.target.value.replace(/,/g, '').replace(/[^0-9]/g, ''))} placeholder="0" className="cn-input tabular" />
            </label>
            {otherAmt && Number(otherAmt) > 0 && (
              <div style={{ background: 'var(--c-navy-tint)', borderRadius: 8, padding: '6px 10px', fontSize: 12, color: 'var(--c-navy)', fontVariantNumeric: 'tabular-nums' }}>
                {Math.round(Number(otherAmt)).toLocaleString('vi-VN')} ₫
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button onClick={() => setOtherModal(null)} style={{ ...btnBase, flex: 1, padding: '10px 14px', background: 'transparent', color: 'var(--c-ink)', border: '1px solid var(--c-line)' }}>{isVI ? 'Hủy' : 'Cancel'}</button>
              <button onClick={handleOtherSave} disabled={saving || !otherDesc.trim() || !otherAmt || Number(otherAmt) <= 0} style={{ ...btnBase, flex: 2, padding: '10px 14px', background: 'var(--c-btn-primary)', color: '#fff', opacity: saving || !otherDesc.trim() || !otherAmt || Number(otherAmt) <= 0 ? 0.6 : 1 }}>
                {saving ? (isVI ? 'Đang lưu...' : 'Saving...') : (isVI ? 'Lưu' : 'Save')}
              </button>
            </div>
          </div>
        </DModal>
      )}

      {showFEManage && (
        <DModal onClose={() => setShowFEManage(false)} title={isVI ? 'Quản lý chi phí cố định' : 'Manage fixed expenses'} width={460}>
          <FixedExpenseManager onChange={onRefresh} onToast={onToast} />
        </DModal>
      )}

      {showRSManage && (
        <DModal onClose={() => setShowRSManage(false)} title={isVI ? 'Tiết kiệm định kỳ' : 'Recurring savings'} width={460}>
          <RecurringSavingManager goals={goals} onChange={onRefresh} onToast={onToast} />
        </DModal>
      )}

      {/* Record buy → the canonical Add-Transaction sheet, opened in edit mode on
          the planned DCA row so saving completes that same transaction. */}
      <AddTransactionSheet
        open={!!buyEdit || !!prefillTx}
        existing={buyEdit}
        prefill={prefillTx}
        desktop
        onClose={() => { setBuyEdit(null); setPrefillTx(null) }}
        onSaved={() => {
          const wasBuy = !!buyEdit
          setBuyEdit(null); setPrefillTx(null); onRefresh()
          onToast(wasBuy ? (isVI ? 'Đã ghi nhận mua' : 'Buy recorded') : (isVI ? 'Đã ghi nhận đóng góp' : 'Contribution logged'))
        }}
      />
    </div>
  )
}
