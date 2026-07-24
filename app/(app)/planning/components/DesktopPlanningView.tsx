'use client'

import React, { useState, useRef } from 'react'
import {
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Target, Shield, ShoppingCart,
  RefreshCw, X, Plus, Settings,
} from 'lucide-react'
import { useLocale } from 'next-intl'
import { toast } from 'sonner'
import { fmt, fmtCompact } from '@/lib/formatters'
import { formatIntVN, parseIntVN } from '@/lib/numberFormat'
import { DesktopPlanningSkeleton } from './PlanningSkeleton'
import FixedExpenseManager from './FixedExpenseManager'
import RecurringSavingManager from './RecurringSavingManager'
import AddTransactionSheet, { type EditableTransaction, type PrefillTransaction } from '@/app/assets/components/AddTransactionSheet'
import RecurringBookTopUpSheet, { type BookTopUpTarget } from '@/app/assets/components/RecurringBookTopUpSheet'
import AddInsuranceMemberModal from '@/app/assets/components/AddInsuranceMemberModal'
import { useDialogA11y } from './useDialogA11y'
import { EditIcon, TrashIcon } from './planningIcons'
import { DPlanRow, DGoalItemRow } from './desktopPlanningRows'
import { type GoalItem } from '@/lib/planning'
import { usePlanningDerivations } from '../usePlanningDerivations'
import { usePlanningActions, buildBuyEdit, buildContributionPrefill } from '../usePlanningActions'
import { saveIncome, deletePlan, saveOtherExpense } from '../planActions'
import { relationshipLabel } from '@/app/assets/components/insuranceShared'
import type {
  MonthlyPlan, FundInvestment, DirectSaving, FixedExpense,
  InsuranceMember, OtherExpense, RecurringSaving, RecurringSavingOverride, RecurringFulfillment, DcaSkip, Fund, Goal,
} from '../PlanningClient'

// ─── Pure helpers ─────────────────────────────────────────────────────────────

const SHORT_MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const SHORT_MONTHS_VI = ['Th1','Th2','Th3','Th4','Th5','Th6','Th7','Th8','Th9','Th10','Th11','Th12']
const LONG_MONTHS_EN  = ['January','February','March','April','May','June','July','August','September','October','November','December']
const LONG_MONTHS_VI  = ['Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6','Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12']

// ─── DModal ───────────────────────────────────────────────────────────────────

function DModal({ onClose, title, width = 400, children }: {
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

function THead({ col1, col2, colRel, colDefault }: { col1: string; col2: string; colRel?: string; colDefault?: string }) {
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
  recurringFulfillments: RecurringFulfillment[]
  dcaSkips: DcaSkip[]
  funds: Fund[]
  goals: Goal[]
  loading: boolean
  error: boolean
  onRetry: () => void
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
  otherExpenses, recurringSavings, recurringSavingOverrides, recurringFulfillments, dcaSkips, funds, goals, loading, error,
  onRetry, onPrev, onNext, onToday, onPlanCreated, onPlanDeleted, onRefresh, onToast,
}: Props) {
  const locale = useLocale()
  const isVI = locale === 'vi'
  const failMsg = isVI ? 'Có lỗi, vui lòng thử lại' : 'Something went wrong — please try again'

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
  const [showAddInsurance, setShowAddInsurance] = useState(false)
  const [showRSManage, setShowRSManage] = useState(false)
  // When set, the recurring manager opens straight on this saving's edit form.
  const [rsEditId, setRsEditId] = useState<string | null>(null)
  // Recording a DCA buy opens the canonical Add-Transaction sheet in edit mode,
  // pre-filled from the planned investment. Saving completes the same planned
  // row (PUT), so it never double-counts against the goal.
  const [buyEdit, setBuyEdit] = useState<EditableTransaction | null>(null)
  // Logging a contribution from a goal header, or recording a recurring bank
  // deposit, opens the same sheet in create mode (POST) pre-filled with the goal.
  const [prefillTx, setPrefillTx] = useState<PrefillTransaction | null>(null)
  const [bookTopUp, setBookTopUp] = useState<BookTopUpTarget | null>(null)

  // ── Derived values ── (shared with the mobile view via usePlanningDerivations)
  const {
    byGoal,
    totalGoals: totalGoalAmount, contributedTotal,
    totalFixed: fixedTotal, totalInsurance: insTotal, totalOther: otherTotal,
    totalOutflow, remaining,
  } = usePlanningDerivations({
    plan, investments, savings, fixedExpenses, insuranceMembers, otherExpenses,
    recurringSavings, recurringSavingOverrides, recurringFulfillments, dcaSkips, funds, goals, isVI,
  })
  const savedPct = plan && plan.salary_vnd > 0 ? Math.round(totalGoalAmount / plan.salary_vnd * 100) : 0

  const shortMonths = isVI ? SHORT_MONTHS_VI : SHORT_MONTHS_EN
  const longMonths  = isVI ? LONG_MONTHS_VI  : LONG_MONTHS_EN
  const monthLabel  = `${longMonths[month - 1]} ${year}`
  const shortLabel  = `${shortMonths[month - 1]} ${year}`
  const todayD      = new Date()
  const isCurrentMonth = month === todayD.getMonth() + 1 && year === todayD.getFullYear()

  // ── API handlers ──
  // Skip/restore/override/record actions are shared with the mobile view via
  // usePlanningActions so a fix lands on both surfaces (#467).
  const actions = usePlanningActions({ plan, month, year, isVI, onRefresh, onToast })

  async function handleSetIncome() {
    const num = Number(incomeVal)
    if (!incomeVal || isNaN(num) || num <= 0) return
    setSaving(true)
    try {
      const r = await saveIncome({ planId: plan?.id, month, year, salaryVnd: num })
      if (!r.ok) { toast.error(failMsg); return }
      if (plan) {
        setShowIncome(false); onRefresh(); onToast(isVI ? 'Đã cập nhật thu nhập' : 'Income updated')
      } else {
        const p = r.data as MonthlyPlan
        setShowIncome(false)
        onPlanCreated({ id: p.id, month: p.month, year: p.year, salary_vnd: p.salary_vnd })
      }
    } finally { setSaving(false) }
  }

  async function handleDeletePlan() {
    if (!plan) return
    setSaving(true)
    try {
      const r = await deletePlan(plan.id)
      if (!r.ok) { toast.error(failMsg); return }
      setShowDelete(false)
      onPlanDeleted()
      onToast(isVI ? `Đã xoá kế hoạch ${monthLabel}` : `Plan for ${monthLabel} deleted`)
    } finally { setSaving(false) }
  }

  const handleFESkip = actions.skipFixedExpense
  const handleFERestore = actions.restoreFixedExpense
  const handleInsSkip = actions.skipInsurance
  const handleInsRestore = actions.restoreInsurance
  const handleRecSkip = actions.skipRecurring
  const handleRecRestore = actions.restoreRecurring
  const handleDcaSkip = actions.skipDca
  const handleDcaRestore = actions.restoreDca

  function openBuy(transactionId?: string) {
    const edit = buildBuyEdit(transactionId, investments)
    if (edit) setBuyEdit(edit)
  }

  // Open the Add-Transaction sheet in create mode, pre-filled toward a goal.
  // Used by the goal-header "+" (log any contribution) and the recurring-bank
  // "Saved" pill (record this month's deposit at the planned amount).
  function openContribution(g: { goalId: string; isUnallocated: boolean }, prefill?: Partial<PrefillTransaction>) {
    setPrefillTx(buildContributionPrefill(g, plan?.id ?? null, prefill))
  }

  // The recurring "Saved" pill: the shared probe decides between opening the
  // book top-up sheet, logging a standalone contribution, or (matured book) a
  // steer-to-maturity toast.
  async function recordRecurring(g: { goalId: string; isUnallocated: boolean }, item: GoalItem) {
    const result = await actions.probeRecurringRecord(item)
    if (result.kind === 'book-topup') setBookTopUp(result.target)
    else if (result.kind === 'contribution') openContribution(g, { asset_type: 'bank', amount_vnd: item.amount })
  }

  async function handleSaveOverride() {
    if (!overrideModal || !plan) return
    const num = Number(overrideVal)
    if (!overrideVal || isNaN(num) || num <= 0) return
    setSaving(true)
    try {
      const ok = await actions.saveOverride({ type: overrideModal.type, id: overrideModal.id, amount: num })
      if (ok) setOverrideModal(null)
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
      const r = await saveOtherExpense({
        planId: plan.id,
        id: isEdit ? (otherModal as OtherExpense).id : null,
        description: otherDesc.trim(),
        amountVnd: Number(otherAmt),
      })
      if (!r.ok) { toast.error(failMsg); return }
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {!isCurrentMonth && (
          <button
            onClick={onToday}
            style={{ padding: '6px 12px', border: '1px solid var(--c-line)', background: 'var(--c-card)', cursor: 'pointer', borderRadius: 8, fontSize: 12, fontWeight: 600, color: 'var(--c-navy)', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 5 }}
          >
            <RefreshCw size={13} />
            {isVI ? 'Hôm nay' : 'Today'}
          </button>
        )}
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
        </div>
      </header>

      {/* ── Two-panel body ───────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>

        {/* Left — main scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 40px', minWidth: 0 }}>
          {loading ? (
            <div data-testid="planning-loading">
              <DesktopPlanningSkeleton />
            </div>
          ) : error ? (
            /* Error state — distinct from the "no plan yet" empty state */
            <div
              data-testid="planning-error-state"
              style={{ padding: '60px 20px', textAlign: 'center', background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 16, maxWidth: 480, margin: '0 auto' }}
            >
              <div style={{ width: 52, height: 52, borderRadius: 26, background: 'var(--c-neg-tint,#fef2f2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14, color: 'var(--c-neg)' }}>
                <svg viewBox="0 0 24 24" width={24} height={24} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                </svg>
              </div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
                {isVI ? 'Không tải được kế hoạch' : "Couldn't load this plan"}
              </h3>
              <p style={{ margin: '6px 0 18px', fontSize: 13, color: 'var(--c-muted)' }}>
                {isVI ? 'Đã xảy ra lỗi khi tải. Vui lòng thử lại.' : 'Something went wrong while loading. Please try again.'}
              </p>
              <button onClick={onRetry} className="cn-btn primary" style={{ padding: '10px 18px' }}>
                <RefreshCw size={14} />
                {isVI ? 'Thử lại' : 'Try again'}
              </button>
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
                    onClick={() => { setRsEditId(null); setShowRSManage(true) }}
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
                    <tr><td colSpan={3} style={{ padding: '16px', textAlign: 'center', color: 'var(--c-muted)', fontSize: 12 }}>{isVI ? 'Chưa có phân bổ nào' : 'No allocations yet'}</td></tr>
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
                          <div data-testid={`plan-goal-planned-${g.goalId}`} data-planned={g.totalAllocated} style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(g.totalAllocated)}</div>
                          <div data-testid={`plan-goal-contributed-${g.goalId}`} data-contributed={g.contributed} style={{ fontSize: 10, color: g.contributed > 0 ? 'var(--c-pos)' : 'var(--c-muted)', marginTop: 2, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
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
                          onEdit={() => { setRsEditId(inv.recurringId ?? null); setShowRSManage(true) }}
                          onOverride={() => {
                            setOverrideModal({ id: inv.recurringId!, name: inv.name, defaultAmount: inv.baseAmount ?? inv.amount, type: 'rec' })
                            setOverrideVal(String(inv.baseAmount ?? inv.amount))
                          }}
                          onRecordBuy={() => openBuy(inv.transactionId)}
                          onRecordDeposit={() => recordRecurring(g, inv)}
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
                    <tr><td colSpan={3} style={{ padding: '16px', textAlign: 'center', color: 'var(--c-muted)', fontSize: 12 }}>{isVI ? 'Chưa có chi phí cố định nào' : 'No fixed expenses yet'}</td></tr>
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
              <PlanTable
                icon={<Shield size={15} />}
                iconColor="var(--c-accent-insurance,#7c3aed)"
                title={isVI ? 'Bảo hiểm' : 'Insurance'}
                total={insTotal}
                action={
                  <button
                    data-testid="desktop-add-insurance"
                    onClick={() => setShowAddInsurance(true)}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', fontSize: 12, fontWeight: 600, color: 'var(--c-navy)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', borderRadius: 8 }}
                  >
                    <Plus size={14} strokeWidth={2.4} />
                    {isVI ? 'Thêm thành viên' : 'Add member'}
                  </button>
                }
              >
                <THead
                  col1={isVI ? 'Thành viên' : 'Member'}
                  colRel={isVI ? 'Quan hệ' : 'Relationship'}
                  colDefault={isVI ? 'Mặc định' : 'Default'}
                  col2={isVI ? 'Tháng này' : 'This month'}
                />
                <tbody>
                  {insuranceMembers.length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: '16px', textAlign: 'center', color: 'var(--c-muted)', fontSize: 12 }}>{isVI ? 'Chưa có thành viên bảo hiểm nào' : 'No insurance members yet'}</td></tr>
                  ) : insuranceMembers.map((m, i) => {
                    const defaultMonthly = Math.round(m.annual_payment_vnd / 12)
                    const monthly    = m.monthlyOverride ?? defaultMonthly
                    const isOverridden = !m.excluded && m.monthlyOverride != null
                    return (
                      <DPlanRow
                        key={m.member_id}
                        primary={m.member_name}
                        relationship={relationshipLabel(m.relationship, isVI)}
                        defaultAmount={defaultMonthly}
                        secondary={m.excluded ? (isVI ? 'Bỏ qua tháng này' : 'Skipped') : isOverridden ? (isVI ? '(đã ghi đè)' : '(overridden)') : null}
                        amount={m.excluded ? 0 : monthly}
                        muted={m.excluded}
                        last={i === insuranceMembers.length - 1}
                        isVI={isVI}
                        onSkip={() => handleInsSkip(m)}
                        onRestore={m.excluded || m.monthlyOverride != null ? () => handleInsRestore(m) : undefined}
                        onOverride={() => { setOverrideModal({ id: m.member_id, name: m.member_name, defaultAmount: defaultMonthly, type: 'ins' }); setOverrideVal(String(m.monthlyOverride ?? defaultMonthly)) }}
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
        {plan && !error && (
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
              <span style={labelStyle}>{isVI ? 'Thu nhập tháng (VND)' : 'Monthly income (VND)'}</span>
              <input
                type="text"
                inputMode="numeric"
                value={formatIntVN(incomeVal)}
                onChange={e => setIncomeVal(parseIntVN(e.target.value))}
                autoFocus
                placeholder="e.g. 45.000.000"
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
              <span style={labelStyle}>{isVI ? 'Số tiền tháng này (VND)' : 'Amount this month (VND)'}</span>
              <input type="text" inputMode="numeric" value={formatIntVN(overrideVal)} onChange={e => setOverrideVal(parseIntVN(e.target.value))} autoFocus className="cn-input tabular" />
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
              <span style={labelStyle}>{isVI ? 'Số tiền (VND)' : 'Amount (VND)'}</span>
              <input type="text" inputMode="numeric" value={formatIntVN(otherAmt)} onChange={e => setOtherAmt(parseIntVN(e.target.value))} placeholder="0" className="cn-input tabular" />
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

      <AddInsuranceMemberModal
        open={showAddInsurance}
        desktop
        locale={locale}
        onClose={() => setShowAddInsurance(false)}
        onCreated={() => { onRefresh(); onToast(isVI ? 'Đã thêm thành viên' : 'Member added') }}
      />

      {showRSManage && (
        <DModal onClose={() => setShowRSManage(false)} title={isVI ? 'Tiết kiệm định kỳ' : 'Recurring savings'} width={460}>
          <RecurringSavingManager goals={goals} onChange={onRefresh} onToast={onToast} editSavingId={rsEditId} />
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

      <RecurringBookTopUpSheet
        target={bookTopUp}
        isVi={isVI}
        onClose={() => setBookTopUp(null)}
        onDone={() => { onRefresh(); onToast(isVI ? 'Đã nạp vào sổ' : 'Topped up book') }}
      />
    </div>
  )
}
