'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { useLocale } from 'next-intl'
import {
  Wallet, Target, Shield, ShoppingCart,
  ChevronDown, ChevronUp,
  MoreHorizontal, Plus, Check, X, Calendar, Settings, RefreshCw, TrendingUp,
} from 'lucide-react'
import { fmt, fmtCompact } from '@/lib/formatters'
import FixedExpenseManager from './FixedExpenseManager'
import RecurringSavingManager from './RecurringSavingManager'
import AddTransactionSheet, { type EditableTransaction, type PrefillTransaction } from '@/app/assets/components/AddTransactionSheet'
import RecurringBookTopUpSheet, { type BookTopUpTarget } from '@/app/assets/components/RecurringBookTopUpSheet'
import { buildByGoal, resolveRecurringSavings, DEPOSIT_BACKED_FULFILLMENT_SOURCES, type GoalRow, type GoalItem } from '@/lib/planning'
import { relationshipLabel } from '@/app/assets/components/insuranceShared'
import { MobilePlanningSkeleton } from './PlanningSkeleton'
import type {
  MonthlyPlan, FundInvestment, DirectSaving, FixedExpense,
  InsuranceMember, OtherExpense, RecurringSaving, RecurringSavingOverride, RecurringFulfillment, DcaSkip, Fund, Goal,
} from '../PlanningClient'

// ─── Types ────────────────────────────────────────────────────────────────────

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
  recurringFulfillments: RecurringFulfillment[]
  dcaSkips: DcaSkip[]
  funds: Fund[]
  goals: Goal[]
  loading?: boolean
  onPlanCreated: (plan: MonthlyPlan) => void
  onPlanDeleted: () => void
  onRefresh: () => void
  onToast: (msg: string) => void
}

type SheetState =
  | null
  | { type: 'salary' }
  | { type: 'delete-plan' }
  | { type: 'override-fe'; expense: FixedExpense }
  | { type: 'override-ins'; member: InsuranceMember }
  | { type: 'override-rec'; item: GoalItem }
  | { type: 'other-expense'; existing: OtherExpense | null }
  | { type: 'manage-fixed' }
  | { type: 'manage-recurring' }

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const LONG_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

function getMonthLabel(month: number, year: number, short = false) {
  const names = short ? SHORT_MONTHS : LONG_MONTHS
  return `${names[month - 1]} ${year}`
}

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

function EditIcon({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4l10-10-4-4L4 16z" /></svg>
}
function TrashIcon({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
}

// ─── Shared sheet overlay wrapper ─────────────────────────────────────────────

function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    if (open) setMounted(true)
    else { const t = setTimeout(() => setMounted(false), 220); return () => clearTimeout(t) }
  }, [open])
  if (!mounted) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.3)',
        zIndex: 200, pointerEvents: open ? 'auto' : 'none',
        display: 'flex', alignItems: 'flex-end',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%', background: 'var(--c-card)', borderRadius: '16px 16px 0 0',
          // overflow:hidden forces iOS WebKit to clip the rounded top corners —
          // without it the slide-up transform composites the layer and the
          // corners render square (issue #319).
          overflow: 'hidden',
          paddingBottom: 'env(safe-area-inset-bottom,0)',
          animation: open ? 'slide-up 220ms cubic-bezier(0.2,0.8,0.2,1)' : 'slide-down 180ms ease forwards',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ width: 36, height: 4, background: 'var(--c-line-strong)', borderRadius: 999, margin: '8px auto 0' }} />
        <div style={{ padding: '14px 16px 0' }}>
          <p style={{ fontWeight: 700, fontSize: 16, color: 'var(--c-ink)', marginBottom: 16 }}>{title}</p>
        </div>
        <div style={{ padding: '0 16px 24px' }}>{children}</div>
      </div>
    </div>
  )
}

// ─── Salary sheet ─────────────────────────────────────────────────────────────

function SalarySheet({
  open, onClose, plan, month, year, onPlanCreated, onRefresh, onToast,
}: {
  open: boolean
  onClose: () => void
  plan: MonthlyPlan | null
  month: number
  year: number
  onPlanCreated: (p: MonthlyPlan) => void
  onRefresh: () => void
  onToast: (msg: string) => void
}) {
  const isVI = useLocale() === 'vi'
  const [value, setValue] = useState(plan ? String(plan.salary_vnd) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { if (open) setValue(plan ? String(plan.salary_vnd) : '') }, [open, plan])

  async function handleSave() {
    const num = Number(value)
    if (!value || isNaN(num) || num <= 0) { setError(isVI ? 'Vui lòng nhập thu nhập hợp lệ' : 'Please enter a valid income'); return }
    setError('')
    setSaving(true)
    try {
      if (plan) {
        const res = await fetch(`/api/v1/monthly-plans/${plan.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ salary_vnd: num }),
        })
        if (!res.ok) { const { error: e } = await res.json(); setError(e ?? 'Error'); setSaving(false); return }
        onRefresh()
        onToast(isVI ? 'Đã lưu thu nhập' : 'Income saved')
      } else {
        const res = await fetch('/api/v1/monthly-plans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ month, year, salary_vnd: num }),
        })
        if (!res.ok) { const { error: e } = await res.json(); setError(e ?? 'Error'); setSaving(false); return }
        const newPlan = await res.json()
        onPlanCreated(newPlan)
        onToast(isVI ? 'Đã thêm thu nhập' : 'Income set')
      }
      onClose()
    } catch { setError(isVI ? 'Lỗi kết nối' : 'Connection error') }
    setSaving(false)
  }

  const label = isVI ? (plan ? 'Sửa thu nhập' : 'Thêm thu nhập') : (plan ? 'Edit income' : 'Set income')

  return (
    <Sheet open={open} onClose={onClose} title={label}>
      <div style={{ display: 'grid', gap: 14 }}>
        <label style={{ fontSize: 13, color: 'var(--c-muted)', display: 'block' }}>
          {isVI ? 'Thu nhập tháng (₫)' : 'Monthly income (₫)'}
        </label>
        {error && <p style={{ color: 'var(--c-neg)', fontSize: 13 }}>{error}</p>}
        <input
          type="text"
          inputMode="numeric"
          value={value ? Number(value).toLocaleString('en-US') : ''}
          onChange={(e) => setValue(e.target.value.replace(/,/g, '').replace(/[^0-9]/g, ''))}
          placeholder="e.g. 45,000,000"
          style={{
            width: '100%', padding: '10px 12px', fontSize: 16, fontVariantNumeric: 'tabular-nums',
            border: '1px solid var(--c-line)', borderRadius: 10,
            background: 'var(--c-card-2)', color: 'var(--c-ink)', boxSizing: 'border-box',
          }}
          data-testid="mobile-salary-input"
          autoFocus
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid var(--c-line)',
              background: 'var(--c-card)', color: 'var(--c-ink)', fontSize: 14, fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {isVI ? 'Hủy' : 'Cancel'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              flex: 2, padding: '10px 0', borderRadius: 10, border: 'none',
              background: 'var(--c-btn-primary)', color: '#fff', fontSize: 14, fontWeight: 600,
              cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit', opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? (isVI ? 'Đang lưu...' : 'Saving...') : (isVI ? 'Lưu' : 'Save')}
          </button>
        </div>
      </div>
    </Sheet>
  )
}

// ─── Delete plan sheet ────────────────────────────────────────────────────────

function DeletePlanSheet({
  open, onClose, monthLabel, onPlanDeleted, planId, onToast,
}: {
  open: boolean
  onClose: () => void
  monthLabel: string
  onPlanDeleted: () => void
  planId: string
  onToast: (msg: string) => void
}) {
  const isVI = useLocale() === 'vi'
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/v1/monthly-plans/${planId}`, { method: 'DELETE' })
      if (res.ok) { onPlanDeleted(); onClose(); onToast(isVI ? 'Đã xoá kế hoạch' : 'Plan deleted') }
    } catch {}
    setDeleting(false)
  }

  return (
    <Sheet open={open} onClose={onClose} title={isVI ? 'Xoá kế hoạch tháng?' : 'Delete monthly plan?'}>
      <div style={{ display: 'grid', gap: 16 }}>
        <div style={{ padding: '12px 14px', background: 'var(--c-neg-tint)', borderRadius: 10 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--c-neg)', lineHeight: 1.5 }}>
            {isVI
              ? `Toàn bộ dữ liệu kế hoạch cho ${monthLabel} sẽ bị xoá vĩnh viễn.`
              : `All plan data for ${monthLabel} will be permanently deleted.`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid var(--c-line)',
              background: 'var(--c-card)', color: 'var(--c-ink)', fontSize: 14, fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {isVI ? 'Huỷ' : 'Cancel'}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            style={{
              flex: 2, padding: '10px 0', borderRadius: 10, border: 'none',
              background: 'var(--c-neg)', color: '#fff', fontSize: 14, fontWeight: 600,
              cursor: deleting ? 'default' : 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <TrashIcon size={14} />
            {deleting ? (isVI ? 'Đang xoá...' : 'Deleting...') : (isVI ? 'Xoá kế hoạch' : 'Delete plan')}
          </button>
        </div>
      </div>
    </Sheet>
  )
}

// ─── Other expense sheet ──────────────────────────────────────────────────────

function OtherExpenseSheet({
  open, onClose, existing, planId, onRefresh, onToast,
}: {
  open: boolean
  onClose: () => void
  existing: OtherExpense | null
  planId: string
  onRefresh: () => void
  onToast: (msg: string) => void
}) {
  const isVI = useLocale() === 'vi'
  const [desc, setDesc] = useState(existing?.description ?? '')
  const [amount, setAmount] = useState(existing?.amount_vnd ? String(existing.amount_vnd) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) { setDesc(existing?.description ?? ''); setAmount(existing?.amount_vnd ? String(existing.amount_vnd) : ''); setError('') }
  }, [open, existing])

  async function handleSave() {
    if (!desc.trim()) { setError(isVI ? 'Vui lòng nhập mô tả' : 'Description is required'); return }
    const num = Number(amount)
    if (!amount || isNaN(num) || num <= 0) { setError(isVI ? 'Vui lòng nhập số tiền hợp lệ' : 'Please enter a valid amount'); return }
    setError('')
    setSaving(true)
    const url = existing
      ? `/api/v1/monthly-plans/${planId}/other-expenses/${existing.id}`
      : `/api/v1/monthly-plans/${planId}/other-expenses`
    try {
      const res = await fetch(url, {
        method: existing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: desc.trim(), amount_vnd: num }),
      })
      if (!res.ok) { const { error: e } = await res.json(); setError(e ?? 'Error'); setSaving(false); return }
      onRefresh()
      onToast(existing ? (isVI ? 'Đã cập nhật' : 'Updated') : (isVI ? 'Đã thêm' : 'Added'))
      onClose()
    } catch { setError(isVI ? 'Lỗi kết nối' : 'Connection error') }
    setSaving(false)
  }

  const title = isVI ? (existing ? 'Sửa khoản chi' : 'Thêm khoản chi') : (existing ? 'Edit expense' : 'Add expense')

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div style={{ display: 'grid', gap: 14 }}>
        {error && <p style={{ color: 'var(--c-neg)', fontSize: 13 }}>{error}</p>}
        <div>
          <label style={{ fontSize: 13, color: 'var(--c-muted)', display: 'block', marginBottom: 4 }}>
            {isVI ? 'Mô tả' : 'Description'}
          </label>
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder={isVI ? 'VD. Mua laptop...' : 'e.g. Buy laptop...'}
            style={{
              width: '100%', padding: '10px 12px', fontSize: 16,
              border: '1px solid var(--c-line)', borderRadius: 10,
              background: 'var(--c-card-2)', color: 'var(--c-ink)', boxSizing: 'border-box',
            }}
            autoFocus
          />
        </div>
        <div>
          <label style={{ fontSize: 13, color: 'var(--c-muted)', display: 'block', marginBottom: 4 }}>
            {isVI ? 'Số tiền (₫)' : 'Amount (₫)'}
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={amount ? Number(amount).toLocaleString('en-US') : ''}
            onChange={(e) => setAmount(e.target.value.replace(/,/g, '').replace(/[^0-9]/g, ''))}
            placeholder="0"
            style={{
              width: '100%', padding: '10px 12px', fontSize: 16, fontVariantNumeric: 'tabular-nums',
              border: '1px solid var(--c-line)', borderRadius: 10,
              background: 'var(--c-card-2)', color: 'var(--c-ink)', boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid var(--c-line)',
              background: 'var(--c-card)', color: 'var(--c-ink)', fontSize: 14, fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {isVI ? 'Hủy' : 'Cancel'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              flex: 2, padding: '10px 0', borderRadius: 10, border: 'none',
              background: 'var(--c-btn-primary)', color: '#fff', fontSize: 14, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {isVI ? 'Lưu' : 'Save'}
          </button>
        </div>
      </div>
    </Sheet>
  )
}

// ─── Stacked bar ─────────────────────────────────────────────────────────────

function StackedBar({ segments, total, height = 8 }: {
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

function NoPlanState({ monthLabel, onSetSalary, isVI }: { monthLabel: string; onSetSalary: () => void; isVI: boolean }) {
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

// ─── SalaryCard ───────────────────────────────────────────────────────────────

function SalaryCard({ amount, isVI, onEdit, onDelete }: { amount: number; isVI: boolean; onEdit: () => void; onDelete: () => void }) {
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
          style={{ padding: 6, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--c-card-2)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <EditIcon size={16} color="var(--c-muted)" />
        </button>
        <button
          onClick={onDelete}
          aria-label="Delete plan"
          style={{ padding: 6, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
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

function AllocationSummaryCard({
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
    <div style={{
      background: 'var(--c-btn-primary)', color: '#fff',
      borderRadius: 16, padding: 16,
      border: '1px solid var(--c-line)', boxShadow: 'var(--shadow-card)',
    }}>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>
        {isVI ? 'Phân bổ tháng này' : "This month's allocation"}
      </div>
      <div style={{ fontSize: 26, fontWeight: 600, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.025em', marginTop: 4 }}>
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
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', minWidth: 30, textAlign: 'right', flexShrink: 0 }}>{pct(r.v)}</span>
          </div>
        ))}
        {/* Remaining row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 7, borderTop: '1px solid rgba(255,255,255,0.12)', marginTop: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: remaining >= 0 ? 'rgba(255,255,255,0.25)' : '#fca5a5', flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 12, color: remaining >= 0 ? 'rgba(255,255,255,0.75)' : '#fca5a5', fontWeight: 600 }}>
            {isVI ? 'Còn lại' : 'Remaining'}
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: remaining >= 0 ? '#86efac' : '#fca5a5' }}>
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

function FixedExpIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M9 8h2M13 8h2M9 12h2M13 12h2M9 16h2M13 16h2" />
    </svg>
  )
}

// ─── BudgetSection ────────────────────────────────────────────────────────────

function BudgetSection({
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

// ─── GoalAllocationRow ────────────────────────────────────────────────────────

function GoalAllocationRow({ entry, isVI, onRecSkip, onRecRestore, onRecOverride, onRecEdit, onRecordBuy, onRecordDeposit, onLogContribution, onDcaSkip, onDcaRestore }: {
  entry: GoalRow; isVI: boolean
  onRecSkip: (item: GoalItem) => void
  onRecRestore: (item: GoalItem) => void
  onRecOverride: (item: GoalItem) => void
  onRecEdit: () => void
  onRecordBuy: (item: GoalItem) => void
  onRecordDeposit: (item: GoalItem) => void
  onLogContribution: () => void
  onDcaSkip: (item: GoalItem) => void
  onDcaRestore: (item: GoalItem) => void
}) {
  const [open, setOpen] = useState(false)
  const pct = entry.totalAllocated > 0 ? Math.min(100, Math.round(entry.contributed / entry.totalAllocated * 100)) : (entry.contributed > 0 ? 100 : 0)
  const met = entry.totalAllocated > 0 && entry.contributed >= entry.totalAllocated
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
          style={{ padding: 4, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, color: 'var(--c-pos)', display: 'flex', flexShrink: 0 }}
        >
          <Plus size={16} strokeWidth={2.4} />
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
          onEdit={onRecEdit}
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
  const skipped = !!item.skipped
  const recorded = !!item.recorded

  const sublabel = skipped
    ? (isVI ? 'Bỏ qua tháng này' : 'Skipped this month')
    : item.overridden
      ? (isVI ? 'Đã ghi đè tháng này' : 'Overridden this month')
      : recorded
        ? item.type === 'bank' ? (isVI ? 'Đã gửi tháng này' : 'Deposited this month') : (isVI ? 'Đã mua' : 'Recorded')
        : item.type === 'fund'
          ? 'Fund'
          : item.isRecurring ? (isVI ? 'Tiết kiệm định kỳ' : 'Recurring saving') : (isVI ? 'Tiết kiệm' : 'Direct saving')

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
          <button ref={btnRef} onClick={() => (menuOpen ? setMenuOpen(false) : openMenu())} aria-label="Saving actions" style={{ padding: 4, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, color: 'var(--c-muted)', display: 'flex', flexShrink: 0 }}>
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <>
              <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 5 }} />
              <div style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 6, background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 8, boxShadow: '0 6px 20px rgba(15,23,42,0.12)', minWidth: 200, overflow: 'hidden' }}>
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
          <button ref={btnRef} onClick={() => (menuOpen ? setMenuOpen(false) : openMenu())} aria-label="DCA actions" style={{ padding: 4, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, color: 'var(--c-muted)', display: 'flex', flexShrink: 0 }}>
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <>
              <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 5 }} />
              <div style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 6, background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 8, boxShadow: '0 6px 20px rgba(15,23,42,0.12)', minWidth: 200, overflow: 'hidden' }}>
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

function PlanLineItem({
  primary, secondary, amount, muted, last, isVI,
  onSkip, onRestore, onOverride,
}: {
  primary: string
  secondary?: string | null
  amount: number
  muted?: boolean
  last?: boolean
  isVI: boolean
  onSkip?: () => void
  onRestore?: () => void
  onOverride?: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)

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
        style={{ padding: 4, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 4, display: 'flex', alignItems: 'center' }}
      >
        <MoreHorizontal size={14} color="var(--c-muted)" />
      </button>
      {menuOpen && (
        <>
          <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
          <div style={{
            position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 51,
            background: 'var(--c-card)', border: '1px solid var(--c-line)',
            borderRadius: 8, boxShadow: 'var(--shadow-pop)',
            minWidth: 170, overflow: 'hidden',
          }}>
            {muted ? (
              <button
                onClick={() => { onRestore?.(); setMenuOpen(false) }}
                style={{ width: '100%', textAlign: 'left', padding: '10px 12px', fontSize: 12, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--c-ink)', display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <Check size={14} color="var(--c-muted)" />
                {isVI ? 'Bao gồm tháng này' : 'Include this month'}
              </button>
            ) : (
              <>
                <button
                  onClick={() => { onOverride?.(); setMenuOpen(false) }}
                  style={{ width: '100%', textAlign: 'left', padding: '10px 12px', fontSize: 12, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--c-ink)', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--c-line)' }}
                >
                  <EditIcon size={14} color="var(--c-muted)" />
                  {isVI ? 'Ghi đè số tiền' : 'Override amount'}
                </button>
                <button
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
      onClick={onClick}
      style={{ width: '100%', textAlign: 'left', padding: '10px 12px', fontSize: 12, background: 'transparent', border: 'none', borderBottom: noBorder ? 'none' : '1px solid var(--c-line)', cursor: 'pointer', fontFamily: 'inherit', color: danger ? 'var(--c-neg)' : 'var(--c-ink)', display: 'flex', alignItems: 'center', gap: 8 }}
    >
      <span style={{ color: danger ? 'var(--c-neg)' : 'var(--c-muted)', display: 'flex' }}>{icon}</span>
      {label}
    </button>
  )
}

// ─── Main MobilePlanningView ──────────────────────────────────────────────────

export default function MobilePlanningView({
  month, year, plan, investments, savings, fixedExpenses, insuranceMembers, otherExpenses,
  recurringSavings, recurringSavingOverrides, recurringFulfillments, dcaSkips, funds, goals, loading,
  onPlanCreated, onPlanDeleted, onRefresh, onToast,
}: Props) {
  const locale = useLocale()
  const isVI = locale === 'vi'
  const [sheet, setSheet] = useState<SheetState>(null)
  // Recording a DCA buy opens the canonical Add-Transaction sheet in edit mode,
  // pre-filled from the planned investment, so saving completes that same
  // planned row (PUT) rather than adding a duplicate contribution.
  const [buyEdit, setBuyEdit] = useState<EditableTransaction | null>(null)
  const [prefillTx, setPrefillTx] = useState<PrefillTransaction | null>(null)
  const [bookTopUp, setBookTopUp] = useState<BookTopUpTarget | null>(null)
  const [overrideTarget, setOverrideTarget] = useState<{ type: 'fe' | 'ins' | 'rec'; id: string; name: string; defaultAmount: number } | null>(null)

  const monthLabel = getMonthLabel(month, year)

  // ─── Computed totals ────────────────────────────────────────────────────────

  const goalsById = useMemo(() => new Map(goals.map(g => [g.goal_id, g.goal_name])), [goals])
  const resolvedRecurring = useMemo(
    () => resolveRecurringSavings(recurringSavings, recurringSavingOverrides),
    [recurringSavings, recurringSavingOverrides],
  )
  // Skipped DCA funds aren't seeded as rows — synthesize struck-through lines.
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
  const fulfillments = useMemo(
    () => new Map(recurringFulfillments.map(f => [f.recurring_saving_id, {
      amount: f.amount_vnd,
      countedAsDeposit: DEPOSIT_BACKED_FULFILLMENT_SOURCES.has(f.source),
    }])),
    [recurringFulfillments],
  )
  const byGoal = useMemo(
    () => buildByGoal([...investments, ...skippedDcaInvestments], savings, resolvedRecurring, goalsById, {
      unallocated: isVI ? 'Chưa phân bổ' : 'Unallocated',
    }, fulfillments),
    [investments, skippedDcaInvestments, savings, resolvedRecurring, goalsById, isVI, fulfillments],
  )
  const totalGoals = useMemo(() => byGoal.reduce((s, g) => s + g.totalAllocated, 0), [byGoal])
  const contributedTotal = useMemo(() => byGoal.reduce((s, g) => s + g.contributed, 0), [byGoal])
  const totalFixed = useMemo(() => getFixedTotal(fixedExpenses), [fixedExpenses])
  const totalInsurance = useMemo(() => getInsTotal(insuranceMembers), [insuranceMembers])
  const totalOther = useMemo(() => otherExpenses.reduce((s, e) => s + e.amount_vnd, 0), [otherExpenses])
  const totalOutflow = totalGoals + totalFixed + totalInsurance + totalOther
  const remaining = plan ? plan.salary_vnd - totalOutflow : 0

  // ─── Skip/restore handlers ─────────────────────────────────────────────────

  async function handleSkipFE(expense: FixedExpense) {
    if (!plan) return
    await fetch(`/api/v1/monthly-plans/${plan.id}/fixed-expense-overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixed_expense_id: expense.expense_id, monthly_amount_override_vnd: 0 }),
    })
    onToast(isVI ? `Đã bỏ qua ${expense.expense_name}` : `Skipped ${expense.expense_name}`)
    onRefresh()
  }

  async function handleRestoreFE(expense: FixedExpense) {
    if (!plan) return
    const res = await fetch(`/api/v1/monthly-plans/${plan.id}/fixed-expense-overrides`)
    if (!res.ok) return
    const overrides: Array<{ id: string; fixed_expense_id: string }> = await res.json()
    const match = overrides.find((o) => o.fixed_expense_id === expense.expense_id)
    if (!match) return
    await fetch(`/api/v1/monthly-plans/${plan.id}/fixed-expense-overrides/${match.id}`, { method: 'DELETE' })
    onToast(isVI ? `Đã khôi phục ${expense.expense_name}` : `Restored ${expense.expense_name}`)
    onRefresh()
  }

  async function handleSkipIns(member: InsuranceMember) {
    if (!plan) return
    await fetch(`/api/v1/monthly-plans/${plan.id}/excluded-insurance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_id: member.member_id }),
    })
    onToast(isVI ? `Đã bỏ qua ${member.member_name}` : `Skipped ${member.member_name}`)
    onRefresh()
  }

  async function handleRestoreIns(member: InsuranceMember) {
    if (!plan) return
    await fetch(`/api/v1/monthly-plans/${plan.id}/excluded-insurance/${member.member_id}`, { method: 'DELETE' })
    onToast(isVI ? `Đã khôi phục ${member.member_name}` : `Restored ${member.member_name}`)
    onRefresh()
  }

  async function handleSkipRec(item: GoalItem) {
    if (!plan || !item.recurringId) return
    await fetch(`/api/v1/monthly-plans/${plan.id}/recurring-saving-overrides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recurring_saving_id: item.recurringId, monthly_amount_override_vnd: 0 }),
    })
    onToast(isVI ? `Đã bỏ qua ${item.name}` : `Skipped ${item.name}`)
    onRefresh()
  }

  async function handleRestoreRec(item: GoalItem) {
    if (!plan || !item.recurringId) return
    const res = await fetch(`/api/v1/monthly-plans/${plan.id}/recurring-saving-overrides`)
    if (!res.ok) return
    const overrides: Array<{ id: string; recurring_saving_id: string }> = await res.json()
    const match = overrides.find((o) => o.recurring_saving_id === item.recurringId)
    if (!match) return
    await fetch(`/api/v1/monthly-plans/${plan.id}/recurring-saving-overrides/${match.id}`, { method: 'DELETE' })
    onToast(isVI ? `Đã khôi phục ${item.name}` : `Restored ${item.name}`)
    onRefresh()
  }

  function openOverrideRec(item: GoalItem) {
    if (!item.recurringId) return
    setOverrideTarget({ type: 'rec', id: item.recurringId, name: item.name, defaultAmount: item.baseAmount ?? item.amount })
    setSheet({ type: 'override-rec', item })
  }

  async function handleDcaSkip(item: GoalItem) {
    if (!plan || !item.fundId) return
    await fetch(`/api/v1/monthly-plans/${plan.id}/dca-skips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fund_id: item.fundId }),
    })
    onToast(isVI ? `Đã bỏ qua ${item.name}` : `Skipped ${item.name}`)
    onRefresh()
  }

  async function handleDcaRestore(item: GoalItem) {
    if (!plan || !item.fundId) return
    await fetch(`/api/v1/monthly-plans/${plan.id}/dca-skips/${item.fundId}`, { method: 'DELETE' })
    onToast(isVI ? `Đã khôi phục ${item.name}` : `Restored ${item.name}`)
    onRefresh()
  }

  // Open the Add-Transaction sheet in create mode, pre-filled toward a goal —
  // the goal-header "+" (log any contribution) and the recurring-bank "Saved"
  // pill (record this month's deposit at the planned amount).
  function openContribution(entry: GoalRow, prefill?: Partial<PrefillTransaction>) {
    setPrefillTx({
      goal_id: entry.isUnallocated ? null : entry.goalId,
      plan_id: plan?.id ?? null,
      investment_date: new Date().toISOString().slice(0, 10),
      ...prefill,
    })
  }

  // The recurring "Saved" pill. If the recurring is linked to an accumulating
  // book, open the prefilled top-up sheet (adds a tranche + marks the month
  // fulfilled). A MATURED book can't be topped up — steer the user to handle its
  // maturity rather than silently logging an unrelated standalone deposit.
  // Otherwise (term-deposit link, or no link) log a standalone contribution.
  async function recordRecurring(entry: GoalRow, item: GoalItem) {
    if (item.linkedDepositTxId && item.recurringId && plan) {
      try {
        const res = await fetch(`/api/v1/investment-transactions/${item.linkedDepositTxId}`)
        if (res.ok) {
          const dep = await res.json()
          const isBookAnchor = dep.deposit_group_id && dep.deposit_group_id === dep.transaction_id
          if (isBookAnchor) {
            const matured = dep.expiry_date && dep.expiry_date < new Date().toISOString().slice(0, 10)
            if (matured) {
              onToast(isVI ? 'Sổ đã đáo hạn — hãy xử lý đáo hạn trước.' : 'This book has matured — handle its maturity first.')
              return
            }
            setBookTopUp({
              savingId: item.recurringId, bookId: dep.transaction_id,
              bookName: dep.notes || (isVI ? 'Sổ ngân hàng' : 'Bank deposit'),
              ym: `${year}-${String(month).padStart(2, '0')}`, planId: plan.id,
              amount: item.amount, rate: dep.interest_rate ?? null,
            })
            return
          }
        }
      } catch { /* fall through to the standard contribution */ }
    }
    openContribution(entry, { asset_type: 'bank', amount_vnd: item.amount })
  }

  function openBuy(item: GoalItem) {
    if (!item.transactionId) return
    const inv = investments.find(i => i.transaction_id === item.transactionId)
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

  // ─── Override sheet helpers ────────────────────────────────────────────────

  function openOverrideFE(expense: FixedExpense) {
    const defaultAmt = (expense.override != null && expense.override > 0) ? expense.override : expense.amount_vnd
    setOverrideTarget({ type: 'fe', id: expense.expense_id, name: expense.expense_name, defaultAmount: defaultAmt })
    setSheet({ type: 'override-fe', expense })
  }

  function openOverrideIns(member: InsuranceMember) {
    const defaultAmt = member.monthlyOverride ?? Math.round(member.annual_payment_vnd / 12)
    setOverrideTarget({ type: 'ins', id: member.member_id, name: member.member_name, defaultAmount: defaultAmt })
    setSheet({ type: 'override-ins', member })
  }

  async function handleOverrideSave(amount: number) {
    if (!plan || !overrideTarget) return
    if (overrideTarget.type === 'fe') {
      await fetch(`/api/v1/monthly-plans/${plan.id}/fixed-expense-overrides`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fixed_expense_id: overrideTarget.id, monthly_amount_override_vnd: amount }),
      })
    } else if (overrideTarget.type === 'rec') {
      await fetch(`/api/v1/monthly-plans/${plan.id}/recurring-saving-overrides`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recurring_saving_id: overrideTarget.id, monthly_amount_override_vnd: amount }),
      })
    } else {
      await fetch(`/api/v1/monthly-plans/${plan.id}/insurance-overrides`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: overrideTarget.id, monthly_amount_override_vnd: amount }),
      })
    }
    setSheet(null)
    setOverrideTarget(null)
    onToast(isVI ? 'Đã ghi đè' : 'Override saved')
    onRefresh()
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="md:hidden" style={{ background: 'var(--c-canvas)', minHeight: '100%' }}>
      <div style={{ padding: '4px 16px 100px', display: 'grid', gap: 10 }}>
        {loading ? (
          <MobilePlanningSkeleton />
        ) : !plan ? (
          <NoPlanState monthLabel={monthLabel} isVI={isVI} onSetSalary={() => setSheet({ type: 'salary' })} />
        ) : (
          <>
            {/* Salary card */}
            <SalaryCard
              amount={plan.salary_vnd}
              isVI={isVI}
              onEdit={() => setSheet({ type: 'salary' })}
              onDelete={() => setSheet({ type: 'delete-plan' })}
            />

            {/* Summary strip */}
            <div style={{
              border: '1px solid var(--c-line)',
              borderRadius: 16, boxShadow: 'var(--shadow-card)',
              display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 1, overflow: 'hidden', background: 'var(--c-line)',
            } as React.CSSProperties}>
              {[
                { l: isVI ? 'Tổng chi' : 'Outflow', v: fmtCompact(totalOutflow), c: 'var(--c-ink)' },
                { l: isVI ? 'Còn lại' : 'Remaining', v: fmtCompact(remaining), c: remaining >= 0 ? 'var(--c-pos)' : 'var(--c-neg)' },
                { l: isVI ? '% Tiết kiệm' : 'Saved %', v: plan.salary_vnd > 0 ? `${Math.round((totalGoals / plan.salary_vnd) * 100)}%` : '—', c: 'var(--c-navy)' },
              ].map((k, i) => (
                <div key={i} style={{ background: 'var(--c-card)', padding: '10px 12px' }}>
                  <div style={{ fontSize: 10, color: 'var(--c-muted)' }}>{k.l}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: k.c, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                    {k.v}
                  </div>
                </div>
              ))}
            </div>

            {/* Allocation summary card */}
            <AllocationSummaryCard
              salary={plan.salary_vnd}
              totalGoals={totalGoals}
              totalFixed={totalFixed}
              totalInsurance={totalInsurance}
              totalOther={totalOther}
              contributedTotal={contributedTotal}
              isVI={isVI}
            />

            {/* By goal section */}
            <BudgetSection
              icon={Target}
              iconColor="var(--c-navy)"
              title={isVI ? 'Theo mục tiêu' : 'By goal'}
              count={`${byGoal.length} ${isVI ? 'mục tiêu' : byGoal.length === 1 ? 'goal' : 'goals'}`}
              total={totalGoals}
              testId="section-by-goal"
              action={
                <button
                  data-testid="mobile-manage-savings"
                  onClick={() => setSheet({ type: 'manage-recurring' })}
                  aria-label={isVI ? 'Quản lý tiết kiệm định kỳ' : 'Manage recurring savings'}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', fontSize: 12, fontWeight: 600, color: 'var(--c-navy)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 6 }}
                >
                  <Settings size={14} />
                  {isVI ? 'Quản lý' : 'Manage'}
                </button>
              }
            >
              {byGoal.length === 0 ? (
                <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--c-muted)' }}>
                  {isVI ? 'Chưa có phân bổ' : 'No allocations yet'}
                </div>
              ) : (
                byGoal.map((entry) => (
                  <GoalAllocationRow
                    key={entry.goalId}
                    entry={entry}
                    isVI={isVI}
                    onRecSkip={handleSkipRec}
                    onRecRestore={handleRestoreRec}
                    onRecOverride={openOverrideRec}
                    onRecEdit={() => setSheet({ type: 'manage-recurring' })}
                    onRecordBuy={openBuy}
                    onRecordDeposit={(item) => recordRecurring(entry, item)}
                    onLogContribution={() => openContribution(entry)}
                    onDcaSkip={handleDcaSkip}
                    onDcaRestore={handleDcaRestore}
                  />
                ))
              )}
            </BudgetSection>

            {/* Fixed expenses section */}
            <BudgetSection
                icon={FixedExpIcon}
                iconColor="var(--c-accent-fixed)"
                title={isVI ? 'Chi phí cố định' : 'Fixed expenses'}
                count={`${fixedExpenses.length} ${isVI ? 'khoản' : fixedExpenses.length === 1 ? 'item' : 'items'}`}
                total={totalFixed}
                testId="section-fixed-expenses"
                action={
                  <button
                    data-testid="mobile-manage-fixed"
                    onClick={() => setSheet({ type: 'manage-fixed' })}
                    aria-label={isVI ? 'Quản lý chi phí cố định' : 'Manage fixed expenses'}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', fontSize: 12, fontWeight: 600, color: 'var(--c-navy)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 6 }}
                  >
                    <Settings size={14} />
                    {isVI ? 'Quản lý' : 'Manage'}
                  </button>
                }
              >
                {fixedExpenses.length === 0 && (
                  <div style={{ padding: '14px', fontSize: 13, color: 'var(--c-muted)' }}>
                    {isVI ? 'Chưa có chi phí cố định.' : 'No fixed expenses yet.'}
                  </div>
                )}
                {fixedExpenses.map((fe, i) => {
                  const isSkipped = fe.override === 0
                  const hasOverride = fe.override != null && fe.override > 0 && fe.override !== fe.amount_vnd
                  const thisMonth = isSkipped ? 0 : (fe.override ?? fe.amount_vnd)
                  const secondary = isSkipped
                    ? (isVI ? 'Bỏ qua tháng này' : 'Skipped')
                    : hasOverride ? (isVI ? '(đã ghi đè)' : '(overridden)') : null
                  return (
                    <PlanLineItem
                      key={fe.expense_id}
                      primary={fe.expense_name}
                      secondary={secondary}
                      amount={thisMonth}
                      muted={isSkipped}
                      last={i === fixedExpenses.length - 1}
                      isVI={isVI}
                      onSkip={() => handleSkipFE(fe)}
                      onRestore={() => handleRestoreFE(fe)}
                      onOverride={() => openOverrideFE(fe)}
                    />
                  )
                })}
              </BudgetSection>

            {/* Insurance section */}
            {insuranceMembers.length > 0 && (
              <BudgetSection
                icon={Shield}
                iconColor="var(--c-accent-insurance)"
                title={isVI ? 'Bảo hiểm' : 'Insurance'}
                count={`${insuranceMembers.length} ${isVI ? 'thành viên' : insuranceMembers.length === 1 ? 'member' : 'members'}`}
                total={totalInsurance}
                testId="section-insurance"
              >
                {insuranceMembers.map((m, i) => {
                  const defaultMonthly = Math.round(m.annual_payment_vnd / 12)
                  const hasOverride = m.monthlyOverride != null && m.monthlyOverride !== defaultMonthly
                  const thisMonth = m.excluded ? 0 : (m.monthlyOverride ?? defaultMonthly)
                  // A phone has no room for Relationship/Default columns (the desktop
                  // table carries those), so the relationship rides the subtitle line.
                  // When overridden, append the default so the user still sees it.
                  const rel = relationshipLabel(m.relationship, isVI)
                  const secondary = m.excluded
                    ? (isVI ? 'Bỏ qua tháng này' : 'Skipped')
                    : hasOverride
                      ? `${rel ? rel + ' · ' : ''}${isVI ? 'mặc định ' : 'default '}${fmt(defaultMonthly)}`
                      : (rel || (isVI ? 'Đóng góp tháng' : 'Monthly contribution'))
                  return (
                    <PlanLineItem
                      key={m.member_id}
                      primary={m.member_name}
                      secondary={secondary}
                      amount={thisMonth}
                      muted={m.excluded}
                      last={i === insuranceMembers.length - 1}
                      isVI={isVI}
                      onSkip={() => handleSkipIns(m)}
                      onRestore={() => handleRestoreIns(m)}
                      onOverride={() => openOverrideIns(m)}
                    />
                  )
                })}
              </BudgetSection>
            )}

            {/* Other expenses section */}
            <BudgetSection
              icon={ShoppingCart}
              iconColor="var(--c-accent-other)"
              title={isVI ? 'Khoản khác' : 'Other'}
              count={`${otherExpenses.length} ${isVI ? 'khoản' : otherExpenses.length === 1 ? 'one-off' : 'one-offs'}`}
              total={totalOther}
              testId="section-other"
            >
              {otherExpenses.map((o, i) => (
                <div
                  key={o.id}
                  style={{
                    padding: '10px 14px 10px 60px', display: 'flex', alignItems: 'center', gap: 8,
                    borderBottom: i === otherExpenses.length - 1 ? 'none' : '1px solid var(--c-line)',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--c-ink)' }}>
                      {o.description}
                    </div>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--c-ink)' }}>
                    {fmt(o.amount_vnd)}
                  </span>
                  <button
                    onClick={() => { setSheet({ type: 'other-expense', existing: o }) }}
                    aria-label="Edit expense"
                    style={{ padding: 4, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 4, display: 'flex', alignItems: 'center' }}
                  >
                    <EditIcon size={14} color="var(--c-muted)" />
                  </button>
                </div>
              ))}
              <div style={{ padding: '10px 14px 12px 60px' }}>
                <button
                  onClick={() => { setSheet({ type: 'other-expense', existing: null }) }}
                  style={{
                    padding: '4px 0', fontSize: 12, color: 'var(--c-navy)',
                    border: 'none', background: 'transparent', cursor: 'pointer',
                    fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4,
                  }}
                >
                  <Plus size={12} strokeWidth={2.4} />
                  {isVI ? 'Thêm khoản' : 'Add item'}
                </button>
              </div>
            </BudgetSection>
          </>
        )}
      </div>

      {/* ─── Salary sheet ──────────────────────────────────────────────────── */}
      <SalarySheet
        open={sheet?.type === 'salary'}
        onClose={() => setSheet(null)}
        plan={plan}
        month={month}
        year={year}
        onPlanCreated={onPlanCreated}
        onRefresh={onRefresh}
        onToast={onToast}
      />

      {/* ─── Delete plan sheet ─────────────────────────────────────────────── */}
      {plan && (
        <DeletePlanSheet
          open={sheet?.type === 'delete-plan'}
          onClose={() => setSheet(null)}
          monthLabel={monthLabel}
          onPlanDeleted={onPlanDeleted}
          planId={plan.id}
          onToast={onToast}
        />
      )}

      {/* ─── Override sheet ────────────────────────────────────────────────── */}
      {overrideTarget && plan && (
        <SimpleOverrideSheet
          open={sheet?.type === 'override-fe' || sheet?.type === 'override-ins' || sheet?.type === 'override-rec'}
          onClose={() => { setSheet(null); setOverrideTarget(null) }}
          name={overrideTarget.name}
          defaultAmount={overrideTarget.defaultAmount}
          planId={plan.id}
          targetId={overrideTarget.id}
          targetType={overrideTarget.type}
          isVI={isVI}
          onSaved={handleOverrideSave}
        />
      )}

      {/* ─── Other expense sheet ───────────────────────────────────────────── */}
      {plan && (
        <OtherExpenseSheet
          open={sheet?.type === 'other-expense'}
          onClose={() => setSheet(null)}
          existing={sheet?.type === 'other-expense' ? sheet.existing : null}
          planId={plan.id}
          onRefresh={onRefresh}
          onToast={onToast}
        />
      )}

      {/* ─── Manage fixed expenses sheet ───────────────────────────────────── */}
      <Sheet
        open={sheet?.type === 'manage-fixed'}
        onClose={() => setSheet(null)}
        title={isVI ? 'Quản lý chi phí cố định' : 'Manage fixed expenses'}
      >
        {sheet?.type === 'manage-fixed' && (
          <FixedExpenseManager onChange={onRefresh} onToast={onToast} variant="sheet" />
        )}
      </Sheet>

      {/* ─── Manage recurring savings sheet ─────────────────────────────────── */}
      <Sheet
        open={sheet?.type === 'manage-recurring'}
        onClose={() => setSheet(null)}
        title={isVI ? 'Tiết kiệm định kỳ' : 'Recurring savings'}
      >
        {sheet?.type === 'manage-recurring' && (
          <RecurringSavingManager goals={goals} onChange={onRefresh} onToast={onToast} variant="sheet" />
        )}
      </Sheet>

      {/* ─── Record buy (edit) / log contribution (create) → Add-Transaction ── */}
      <AddTransactionSheet
        open={!!buyEdit || !!prefillTx}
        existing={buyEdit}
        prefill={prefillTx}
        onClose={() => { setBuyEdit(null); setPrefillTx(null) }}
        onSaved={() => {
          const wasBuy = !!buyEdit
          setBuyEdit(null); setPrefillTx(null)
          onToast(wasBuy ? (isVI ? 'Đã ghi nhận mua' : 'Buy recorded') : (isVI ? 'Đã ghi nhận đóng góp' : 'Contribution logged'))
          onRefresh()
        }}
      />

      <RecurringBookTopUpSheet
        target={bookTopUp}
        isVi={isVI}
        onClose={() => setBookTopUp(null)}
        onDone={() => { onToast(isVI ? 'Đã nạp vào sổ' : 'Topped up book'); onRefresh() }}
      />
    </div>
  )
}


// ─── SimpleOverrideSheet (used inline — keeps handleOverrideSave in parent) ───

function SimpleOverrideSheet({
  open, onClose, name, defaultAmount, planId, targetId, targetType, isVI, onSaved,
}: {
  open: boolean
  onClose: () => void
  name: string
  defaultAmount: number
  planId: string
  targetId: string
  targetType: 'fe' | 'ins' | 'rec'
  isVI: boolean
  onSaved: (amount: number) => void
}) {
  const [value, setValue] = useState(String(defaultAmount))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { if (open) { setValue(String(defaultAmount)); setError('') } }, [open, defaultAmount])

  async function handleSave() {
    const num = Number(value)
    if (!value || isNaN(num) || num <= 0) { setError(isVI ? 'Vui lòng nhập số tiền hợp lệ' : 'Please enter a valid amount'); return }
    setError('')
    setSaving(true)
    try {
      const endpoint = targetType === 'fe' ? 'fixed-expense-overrides' : 'insurance-overrides'
      const body = targetType === 'fe'
        ? { fixed_expense_id: targetId, monthly_amount_override_vnd: num }
        : { member_id: targetId, monthly_amount_override_vnd: num }
      await fetch(`/api/v1/monthly-plans/${planId}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      onSaved(num)
    } catch { setError(isVI ? 'Lỗi kết nối' : 'Connection error') }
    setSaving(false)
  }

  return (
    <Sheet open={open} onClose={onClose} title={isVI ? 'Ghi đè số tiền' : 'Override amount'}>
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ fontSize: 13, color: 'var(--c-muted)' }}>{name}</div>
        {error && <p style={{ color: 'var(--c-neg)', fontSize: 13 }}>{error}</p>}
        <input
          type="text"
          inputMode="numeric"
          value={value ? Number(value).toLocaleString('en-US') : ''}
          onChange={(e) => setValue(e.target.value.replace(/,/g, '').replace(/[^0-9]/g, ''))}
          style={{
            width: '100%', padding: '10px 12px', fontSize: 15,
            border: '1px solid var(--c-line)', borderRadius: 10,
            background: 'var(--c-card-2)', color: 'var(--c-ink)', boxSizing: 'border-box',
          }}
          autoFocus
        />
        <button
          onClick={() => setValue(String(defaultAmount))}
          style={{
            alignSelf: 'flex-start', padding: '4px 8px', fontSize: 11,
            background: 'transparent', border: '1px solid var(--c-line)',
            borderRadius: 6, color: 'var(--c-navy)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500,
          }}
        >
          {isVI ? 'Mặc định' : 'Default'}: {fmtCompact(defaultAmount)}
        </button>
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid var(--c-line)', background: 'var(--c-card)', color: 'var(--c-ink)', fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
            {isVI ? 'Hủy' : 'Cancel'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ flex: 2, padding: '10px 0', borderRadius: 10, border: 'none', background: 'var(--c-btn-primary)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {isVI ? 'Lưu' : 'Save'}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
