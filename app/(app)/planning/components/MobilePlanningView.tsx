'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { useLocale } from 'next-intl'
import {
  Wallet, Target, Building, Shield, ShoppingCart,
  ChevronDown, ChevronUp,
  MoreHorizontal, Plus, Edit2, Trash2, Check, RefreshCw, X, Calendar,
} from 'lucide-react'
import { fmtCompact, fmt } from '@/lib/formatters'
import type {
  MonthlyPlan, FundInvestment, DirectSaving, FixedExpense,
  InsuranceMember, OtherExpense, Fund, Goal,
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
  funds: Fund[]
  goals: Goal[]
  onPlanCreated: (plan: MonthlyPlan) => void
  onPlanDeleted: () => void
  onRefresh: () => void
  onToast: (msg: string) => void
}

interface GoalRow {
  goalId: string
  goalName: string
  totalAllocated: number
  items: Array<{ name: string; type: string; amount: number; isDCA?: boolean }>
}

type SheetState =
  | null
  | { type: 'salary' }
  | { type: 'delete-plan' }
  | { type: 'override-fe'; expense: FixedExpense }
  | { type: 'override-ins'; member: InsuranceMember }
  | { type: 'other-expense'; existing: OtherExpense | null }

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

function buildByGoal(investments: FundInvestment[], savings: DirectSaving[]): GoalRow[] {
  const map = new Map<string, GoalRow>()

  for (const inv of investments) {
    const goalId = inv.goal_id ?? '__unassigned__'
    const goalName = inv.savings_goals?.goal_name ?? 'Unassigned'
    if (!map.has(goalId)) {
      map.set(goalId, { goalId, goalName, totalAllocated: 0, items: [] })
    }
    const row = map.get(goalId)!
    row.totalAllocated += inv.amount_vnd
    row.items.push({ name: inv.funds?.name ?? 'Unknown fund', type: 'fund', amount: inv.amount_vnd, isDCA: inv.is_dca_seeded })
  }

  for (const sav of savings) {
    const goalId = sav.goal_id ?? '__unassigned__'
    const goalName = sav.savings_goals?.goal_name ?? 'Unassigned'
    if (!map.has(goalId)) {
      map.set(goalId, { goalId, goalName, totalAllocated: 0, items: [] })
    }
    const row = map.get(goalId)!
    row.totalAllocated += sav.amount_vnd
    row.items.push({ name: 'Direct savings', type: 'bank', amount: sav.amount_vnd })
  }

  return [...map.values()].sort((a, b) => a.goalName.localeCompare(b.goalName))
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
              background: 'var(--c-navy)', color: '#fff', fontSize: 14, fontWeight: 600,
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
            <Trash2 size={14} />
            {deleting ? (isVI ? 'Đang xoá...' : 'Deleting...') : (isVI ? 'Xoá kế hoạch' : 'Delete plan')}
          </button>
        </div>
      </div>
    </Sheet>
  )
}

// ─── Override sheet (fixed expense or insurance) ──────────────────────────────

function OverrideSheet({
  open, onClose, name, defaultAmount, planId, apiPath, onRefresh, onToast,
}: {
  open: boolean
  onClose: () => void
  name: string
  defaultAmount: number
  planId: string
  apiPath: string
  onRefresh: () => void
  onToast: (msg: string) => void
}) {
  const isVI = useLocale() === 'vi'
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
      const res = await fetch(`/api/v1/monthly-plans/${planId}/${apiPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(apiPath.includes('fixed') ? { fixed_expense_id: apiPath.split('/')[0], monthly_amount_override_vnd: num } : { member_id: apiPath.split('/')[0], monthly_amount_override_vnd: num }),
      })
      if (!res.ok) { const { error: e } = await res.json(); setError(e ?? 'Error'); setSaving(false); return }
      onRefresh()
      onToast(isVI ? 'Đã lưu' : 'Saved')
      onClose()
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
            disabled={saving || !value || Number(value) <= 0}
            style={{
              flex: 2, padding: '10px 0', borderRadius: 10, border: 'none',
              background: 'var(--c-navy)', color: '#fff', fontSize: 14, fontWeight: 600,
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
              width: '100%', padding: '10px 12px', fontSize: 14,
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
              width: '100%', padding: '10px 12px', fontSize: 14, fontVariantNumeric: 'tabular-nums',
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
              background: 'var(--c-navy)', color: '#fff', fontSize: 14, fontWeight: 600,
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
          background: 'var(--c-navy)', color: '#fff', fontSize: 13, fontWeight: 600,
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
          {fmtCompact(amount)}
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
          <Edit2 size={16} color="var(--c-muted)" />
        </button>
        <button
          onClick={onDelete}
          aria-label="Delete plan"
          style={{ padding: 6, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--c-card-2)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <Trash2 size={16} color="var(--c-neg)" />
        </button>
      </div>
    </div>
  )
}

// ─── AllocationSummaryCard ────────────────────────────────────────────────────

function AllocationSummaryCard({
  salary, totalGoals, totalFixed, totalInsurance, totalOther, isVI,
}: {
  salary: number
  totalGoals: number
  totalFixed: number
  totalInsurance: number
  totalOther: number
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
      background: 'var(--c-navy)', color: '#fff',
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
            <span style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(r.v)}</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', minWidth: 30, textAlign: 'right' }}>{pct(r.v)}</span>
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
    </div>
  )
}

// ─── BudgetSection ────────────────────────────────────────────────────────────

function BudgetSection({
  icon: Icon, iconColor, title, total, count, defaultOpen = true, children, testId,
}: {
  icon: React.ElementType
  iconColor: string
  title: string
  total: number
  count?: string
  defaultOpen?: boolean
  children: React.ReactNode
  testId?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div data-testid="budget-section" style={{
      background: 'var(--c-card)', border: '1px solid var(--c-line)',
      borderRadius: 16, boxShadow: 'var(--shadow-card)', overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen((o) => !o)}
        data-testid={testId}
        style={{
          width: '100%', textAlign: 'left',
          background: 'transparent', border: 'none', cursor: 'pointer',
          padding: '14px', display: 'flex', alignItems: 'center', gap: 12,
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
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-ink)' }}>{title}</div>
          {count && <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 2 }}>{count}</div>}
        </div>
        <span style={{ fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--c-ink)' }}>
          {fmtCompact(total)}
        </span>
        {open ? <ChevronUp size={16} color="var(--c-muted)" /> : <ChevronDown size={16} color="var(--c-muted)" />}
      </button>
      {open && (
        <div style={{ borderTop: '1px solid var(--c-line)', background: 'var(--c-card-2)' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ─── GoalAllocationRow ────────────────────────────────────────────────────────

function GoalAllocationRow({ entry, isVI }: { entry: GoalRow; isVI: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer',
          padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10,
          borderTop: '1px solid var(--c-line)', fontFamily: 'inherit',
        }}
      >
        <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--c-navy-tint)', color: 'var(--c-navy)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Target size={14} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--c-ink)' }}>
            {entry.goalName}
          </div>
          <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 1 }}>
            {entry.items.length} {isVI ? 'khoản' : entry.items.length === 1 ? 'allocation' : 'allocations'}
          </div>
        </div>
        <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--c-ink)' }}>
          {fmtCompact(entry.totalAllocated)}
        </span>
        {open ? <ChevronUp size={14} color="var(--c-muted)" /> : <ChevronDown size={14} color="var(--c-muted)" />}
      </button>
      {open && entry.items.map((item, i) => (
        <div key={i} style={{
          padding: '8px 14px 8px 56px', display: 'flex', alignItems: 'center',
          borderTop: '1px solid var(--c-line)', background: 'var(--c-card)',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--c-ink)' }}>
              {item.name}
            </div>
            <div style={{ fontSize: 10, color: 'var(--c-muted)', textTransform: 'capitalize', marginTop: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
              {item.type}
              {item.isDCA && (
                <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: 'var(--c-navy-tint)', color: 'var(--c-navy)', fontWeight: 600 }}>DCA</span>
              )}
            </div>
          </div>
          <span style={{ fontSize: 12, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: 'var(--c-muted)' }}>
            {fmtCompact(item.amount)}
          </span>
        </div>
      ))}
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
        {fmtCompact(muted ? 0 : amount)}
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
                  <Edit2 size={14} color="var(--c-muted)" />
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

// ─── Main MobilePlanningView ──────────────────────────────────────────────────

export default function MobilePlanningView({
  month, year, plan, investments, savings, fixedExpenses, insuranceMembers, otherExpenses,
  funds, goals, onPlanCreated, onPlanDeleted, onRefresh, onToast,
}: Props) {
  const locale = useLocale()
  const isVI = locale === 'vi'
  const [sheet, setSheet] = useState<SheetState>(null)
  const [overrideTarget, setOverrideTarget] = useState<{ type: 'fe' | 'ins'; id: string; name: string; defaultAmount: number } | null>(null)
  const [otherSheetTarget, setOtherSheetTarget] = useState<OtherExpense | null | 'new'>('new')

  const monthLabel = getMonthLabel(month, year)
  const shortLabel = getMonthLabel(month, year, true)

  // ─── Computed totals ────────────────────────────────────────────────────────

  const byGoal = useMemo(() => buildByGoal(investments, savings), [investments, savings])
  const totalGoals = useMemo(() => byGoal.reduce((s, g) => s + g.totalAllocated, 0), [byGoal])
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
        {!plan ? (
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
            >
              {byGoal.length === 0 ? (
                <div style={{ padding: '12px 14px', fontSize: 13, color: 'var(--c-muted)' }}>
                  {isVI ? 'Chưa có phân bổ' : 'No allocations yet'}
                </div>
              ) : (
                byGoal.map((entry) => <GoalAllocationRow key={entry.goalId} entry={entry} isVI={isVI} />)
              )}
            </BudgetSection>

            {/* Fixed expenses section */}
            {fixedExpenses.length > 0 && (
              <BudgetSection
                icon={Building}
                iconColor="var(--c-accent-fixed)"
                title={isVI ? 'Chi phí cố định' : 'Fixed expenses'}
                count={`${fixedExpenses.length} ${isVI ? 'khoản' : fixedExpenses.length === 1 ? 'item' : 'items'}`}
                total={totalFixed}
                testId="section-fixed-expenses"
              >
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
            )}

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
                  const secondary = m.excluded
                    ? (isVI ? 'Bỏ qua tháng này' : 'Skipped')
                    : hasOverride ? (isVI ? '(đã ghi đè)' : '(overridden)') : (isVI ? 'Đóng góp tháng' : 'Monthly contribution')
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
                    {fmtCompact(o.amount_vnd)}
                  </span>
                  <button
                    onClick={() => { setOtherSheetTarget(o); setSheet({ type: 'other-expense', existing: o }) }}
                    aria-label="Edit expense"
                    style={{ padding: 4, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 4, display: 'flex', alignItems: 'center' }}
                  >
                    <Edit2 size={14} color="var(--c-muted)" />
                  </button>
                </div>
              ))}
              <div style={{ padding: '10px 14px 12px 60px' }}>
                <button
                  onClick={() => { setOtherSheetTarget('new'); setSheet({ type: 'other-expense', existing: null }) }}
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
          open={sheet?.type === 'override-fe' || sheet?.type === 'override-ins'}
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
  targetType: 'fe' | 'ins'
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
            style={{ flex: 2, padding: '10px 0', borderRadius: 10, border: 'none', background: 'var(--c-navy)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            {isVI ? 'Lưu' : 'Save'}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
