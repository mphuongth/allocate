'use client'

// The mobile planning view's presentational cards, states, and section shell (#467):
// the income (SalaryCard) and allocation-summary cards, the no-plan / error empty
// states, the collapsible BudgetSection wrapper, and the StackedBar. All are
// prop-driven and layout-only — the view owns the data and passes it in.
import { useState } from 'react'
import { Wallet, RefreshCw, Plus, ChevronUp, ChevronDown, Calendar } from 'lucide-react'
import { fmt, fmtCompact } from '@/lib/formatters'
import { EditIcon, TrashIcon } from './planningIcons'

export function StackedBar({ segments, total, height = 8 }: {
  segments: Array<{ value: number; color: string }>
  total: number
  height?: number
}) {
  if (total <= 0) return <div style={{ height, borderRadius: 999, background: 'rgba(255,255,255,0.15)' }} />
  return (
    <div style={{ height, borderRadius: 999, overflow: 'hidden', display: 'flex' }}>
      {segments.map((seg, i) => {
        const pct = Math.min(100, (seg.value / total) * 100)
        if (pct <= 0) return null
        return (
          <div key={i} style={{ width: `${pct}%`, background: seg.color, flexShrink: 0 }} />
        )
      })}
    </div>
  )
}

// ─── NoPlanState ─────────────────────────────────────────────────────────────

export function NoPlanState({ monthLabel, onSetSalary, isVI }: { monthLabel: string; onSetSalary: () => void; isVI: boolean }) {
  return (
    <div style={{
      padding: '44px 20px', textAlign: 'center',
      background: 'var(--c-card)', border: '1px dashed var(--c-line-strong)',
      borderRadius: 16,
    }}>
      <div style={{ width: 48, height: 48, borderRadius: 24, background: 'var(--c-card-2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12, color: 'var(--c-muted)' }}>
        <Calendar size={22} />
      </div>
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--c-ink)' }}>
        {isVI ? `Chưa có kế hoạch cho ${monthLabel}` : `No plan for ${monthLabel}`}
      </h3>
      <p style={{ margin: '4px 0 16px', fontSize: 12, color: 'var(--c-muted)' }}>
        {isVI ? 'Nhập thu nhập để bắt đầu phân bổ.' : 'Enter your income to start allocating.'}
      </p>
      <button
        onClick={onSetSalary}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '9px 16px', borderRadius: 10, border: 'none',
          background: 'var(--c-btn-primary)', color: '#fff', fontSize: 13, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <Plus size={14} strokeWidth={2.4} />
        {isVI ? 'Thêm thu nhập' : 'Set income'}
      </button>
    </div>
  )
}

// ─── PlanErrorState ──────────────────────────────────────────────────────────
// A failed load (≠ 404) — distinct from the "no plan yet" empty state, with retry.

export function PlanErrorState({ isVI, onRetry }: { isVI: boolean; onRetry?: () => void }) {
  return (
    <div data-testid="planning-error-state" style={{
      padding: '44px 20px', textAlign: 'center',
      background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 16,
    }}>
      <div style={{ width: 48, height: 48, borderRadius: 24, background: 'var(--c-neg-tint)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12, color: 'var(--c-neg)' }}>
        <svg viewBox="0 0 24 24" width={22} height={22} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        </svg>
      </div>
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--c-ink)' }}>
        {isVI ? 'Không tải được kế hoạch' : "Couldn't load this plan"}
      </h3>
      <p style={{ margin: '4px 0 16px', fontSize: 12, color: 'var(--c-muted)' }}>
        {isVI ? 'Đã xảy ra lỗi khi tải. Vui lòng thử lại.' : 'Something went wrong while loading. Please try again.'}
      </p>
      <button
        onClick={onRetry}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '9px 16px', borderRadius: 10, border: 'none',
          background: 'var(--c-btn-primary)', color: '#fff', fontSize: 13, fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <RefreshCw size={14} />
        {isVI ? 'Thử lại' : 'Try again'}
      </button>
    </div>
  )
}

// ─── SalaryCard ───────────────────────────────────────────────────────────────

export function SalaryCard({ amount, isVI, onEdit, onDelete }: { amount: number; isVI: boolean; onEdit: () => void; onDelete: () => void }) {
  return (
    <div style={{
      background: 'var(--c-card)', border: '1px solid var(--c-line)',
      borderRadius: 16, boxShadow: 'var(--shadow-card)',
      padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 8,
        background: 'var(--c-pos-tint)', color: 'var(--c-pos)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Wallet size={16} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: 'var(--c-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>
          {isVI ? 'Thu nhập tháng' : 'Monthly income'}
        </div>
        <div style={{ fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
          {fmt(amount)}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          onClick={onEdit}
          aria-label="Edit income"
          style={{ minWidth: 44, minHeight: 44, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--c-card-2)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <EditIcon size={16} color="var(--c-muted)" />
        </button>
        <button
          onClick={onDelete}
          aria-label="Delete plan"
          style={{ minWidth: 44, minHeight: 44, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--c-card-2)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <TrashIcon size={16} color="var(--c-neg)" />
        </button>
      </div>
    </div>
  )
}

// ─── AllocationSummaryCard ────────────────────────────────────────────────────

export function AllocationSummaryCard({
  salary, totalGoals, totalFixed, totalInsurance, totalOther, contributedTotal, isVI,
}: {
  salary: number
  totalGoals: number
  totalFixed: number
  totalInsurance: number
  totalOther: number
  contributedTotal: number
  isVI: boolean
}) {
  const totalAllocated = totalGoals + totalFixed + totalInsurance + totalOther
  const remaining = salary - totalAllocated
  const pct = (v: number) => salary > 0 ? `${Math.round((v / salary) * 100)}%` : '—'

  const rows = [
    ...(totalGoals > 0 ? [{ l: isVI ? 'Đầu tư & tiết kiệm' : 'Invest & save', v: totalGoals, color: 'var(--c-accent-fund)' }] : []),
    ...(totalFixed > 0 ? [{ l: isVI ? 'Chi phí cố định' : 'Fixed expenses', v: totalFixed, color: 'var(--c-accent-fixed)' }] : []),
    ...(totalInsurance > 0 ? [{ l: isVI ? 'Bảo hiểm' : 'Insurance', v: totalInsurance, color: 'var(--c-accent-insurance)' }] : []),
    ...(totalOther > 0 ? [{ l: isVI ? 'Khoản khác' : 'Other', v: totalOther, color: 'var(--c-accent-other)' }] : []),
  ]

  const segments = rows.map((r) => ({ value: r.v, color: r.color }))

  return (
    <div data-testid="planning-alloc-card" style={{
      background: 'var(--c-btn-primary)', color: '#fff',
      borderRadius: 16, padding: 16,
      border: '1px solid var(--c-line)', boxShadow: 'var(--shadow-card)',
    }}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>
        {isVI ? 'Phân bổ tháng này' : "This month's allocation"}
      </div>
      <div style={{ fontSize: 26, fontWeight: 600, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.025em', marginTop: 4, whiteSpace: 'nowrap' }}>
        {fmtCompact(totalAllocated)}
      </div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
        {pct(totalAllocated)} {isVI ? 'thu nhập' : 'of income'}
        {remaining < 0 && (
          <span style={{ color: '#fca5a5', marginLeft: 8 }}>
            ⚠ {isVI ? 'Vượt ngân sách' : 'Over budget'}
          </span>
        )}
      </div>

      {/* Stacked bar */}
      <div style={{ marginTop: 12, padding: 2, background: 'rgba(255,255,255,0.08)', borderRadius: 999 }}>
        <StackedBar segments={segments} total={salary} height={8} />
      </div>

      {/* Category rows */}
      <div style={{ marginTop: 12, display: 'grid', gap: 7 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: r.color, flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.75)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.l}</span>
            <span style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtCompact(r.v)}</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', minWidth: 30, textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap' }}>{pct(r.v)}</span>
          </div>
        ))}
        {/* Remaining row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 7, borderTop: '1px solid rgba(255,255,255,0.12)', marginTop: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: remaining >= 0 ? 'rgba(255,255,255,0.25)' : '#fca5a5', flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 12, color: remaining >= 0 ? 'rgba(255,255,255,0.75)' : '#fca5a5', fontWeight: 600 }}>
            {isVI ? 'Còn lại' : 'Remaining'}
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: remaining >= 0 ? '#86efac' : '#fca5a5', whiteSpace: 'nowrap' }}>
            {remaining >= 0 ? '+' : ''}{fmtCompact(remaining)}
          </span>
        </div>
      </div>

      {totalGoals > 0 && (
        <div data-testid="planning-contributed" style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.12)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>{isVI ? 'Đã góp tháng này' : 'Contributed this month'}</span>
            <span style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {fmtCompact(contributedTotal)} <span style={{ color: 'rgba(255,255,255,0.45)' }}>/ {fmtCompact(totalGoals)}</span>
            </span>
          </div>
          <div style={{ marginTop: 8, height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.min(100, totalGoals > 0 ? Math.round(contributedTotal / totalGoals * 100) : 0)}%`, background: '#86efac', borderRadius: 999, transition: 'width 200ms' }} />
          </div>
        </div>
      )}
    </div>
  )
}

export function FixedExpIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M9 8h2M13 8h2M9 12h2M13 12h2M9 16h2M13 16h2" />
    </svg>
  )
}

// ─── BudgetSection ────────────────────────────────────────────────────────────

export function BudgetSection({
  icon: Icon, iconColor, title, total, count, defaultOpen = true, children, testId, action,
}: {
  icon: React.ElementType
  iconColor: string
  title: string
  total: number
  count?: string
  defaultOpen?: boolean
  children: React.ReactNode
  testId?: string
  action?: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const toggle = () => setOpen((o) => !o)
  return (
    <div data-testid="budget-section" style={{
      background: 'var(--c-card)', border: '1px solid var(--c-line)',
      borderRadius: 16, boxShadow: 'var(--shadow-card)', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px' }}>
        <button
          onClick={toggle}
          data-testid={testId}
          style={{
            flex: 1, minWidth: 0, textAlign: 'left',
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: 0, display: 'flex', alignItems: 'center', gap: 12,
            fontFamily: 'inherit',
          }}
        >
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: 'var(--c-card-2)', color: iconColor,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Icon size={16} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
            {/* Full total sits under the title (next to the count) so the wider
                exact amount doesn't collide with the action/chevron on the right. */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--c-ink)' }}>{fmt(total)}</span>
              {count && <span style={{ fontSize: 11, color: 'var(--c-muted)' }}>· {count}</span>}
            </div>
          </div>
        </button>
        {action}
        <button onClick={toggle} aria-label="Toggle section" style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', color: 'var(--c-muted)', padding: 0 }}>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      </div>
      {open && (
        <div style={{ borderTop: '1px solid var(--c-line)', background: 'var(--c-card-2)' }}>
          {children}
        </div>
      )}
    </div>
  )
}
