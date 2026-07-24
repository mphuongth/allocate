'use client'

// The desktop planning view's shell + summary cards (#467): the DModal dialog
// wrapper, the collapsible PlanTable section + its THead, the AllocationCard budget
// summary and its StackedBar. Prop-driven and layout-only — DesktopPlanningView
// owns the data and passes it in.
import { useState, useRef } from 'react'
import { ChevronUp, ChevronDown, X } from 'lucide-react'
import { fmt, fmtCompact } from '@/lib/formatters'
import { useDialogA11y } from './useDialogA11y'

export function DModal({ onClose, title, width = 400, children }: {
  onClose: () => void; title: string; width?: number; children: React.ReactNode
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogA11y(dialogRef, true, onClose)
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, backdropFilter: 'blur(2px)', animation: 'fade-in 150ms ease' }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: width, maxHeight: 'calc(100vh - 48px)', background: 'var(--c-card)', borderRadius: 16, boxShadow: '0 24px 48px rgba(15,23,42,0.18), 0 8px 16px rgba(15,23,42,0.08)', display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'modal-in 200ms cubic-bezier(0.2,0.8,0.2,1)', outline: 'none' }}
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

export function PlanTable({ icon, iconColor, title, total, defaultOpen = true, action, children }: {
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

export function THead({ col1, col2, colRel, colDefault }: { col1: string; col2: string; colRel?: string; colDefault?: string }) {
  const thBase = { fontSize: 10, fontWeight: 600 as const, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: 'var(--c-muted)' }
  return (
    <thead>
      <tr style={{ background: 'var(--c-card-2)', borderBottom: '1px solid var(--c-line)' }}>
        <th style={{ padding: '8px 16px', textAlign: 'left', ...thBase }}>{col1}</th>
        {colRel != null && <th style={{ padding: '8px 12px', textAlign: 'left', ...thBase }}>{colRel}</th>}
        {colDefault != null && <th style={{ padding: '8px 12px', textAlign: 'right', ...thBase }}>{colDefault}</th>}
        <th style={{ padding: '8px 12px', textAlign: 'right', ...thBase }}>{col2}</th>
        <th style={{ width: 40 }} />
      </tr>
    </thead>
  )
}

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

export function AllocationCard({ salary, totalGoalAmount, fixedTotal, insTotal, otherTotal, contributedTotal, isVI }: {
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
      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
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
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', minWidth: 30, textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap' }}>{pct(r.v)}</span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.12)', marginTop: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: remaining >= 0 ? 'rgba(255,255,255,0.25)' : '#fca5a5', flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: remaining >= 0 ? 'rgba(255,255,255,0.8)' : '#fca5a5' }}>
            {isVI ? 'Còn lại' : 'Remaining'}
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, color: remaining >= 0 ? '#86efac' : '#fca5a5', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
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
