'use client'

// The mobile planning view's bottom-sheet dialogs (#467): the shared Sheet overlay
// wrapper and the salary / delete-plan / other-expense / simple-override sheets.
// The income/delete/other-expense writes go through planActions; the override sheet
// hands its amount up to the parent. Layout + local form state only.
import { useState, useRef } from 'react'
import { useLocale } from 'next-intl'
import { formatIntVN, parseIntVN } from '@/lib/numberFormat'
import { fmtCompact } from '@/lib/formatters'
import { useDialogA11y } from '@/components/ui/useDialogA11y'
import { TrashIcon } from './planningIcons'
import { saveIncome, deletePlan, saveOtherExpense } from '../planActions'
import type { MonthlyPlan, OtherExpense } from '@/features/planning/contracts'
import { useDialogMount, useResetOnOpen } from '@/components/ui/useDialogMount'

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const mounted = useDialogMount(open)
  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogA11y(dialogRef, open && mounted, onClose)
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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{
          width: '100%', background: 'var(--c-card)', borderRadius: '16px 16px 0 0',
          // overflow:hidden forces iOS WebKit to clip the rounded top corners —
          // without it the slide-up transform composites the layer and the
          // corners render square (issue #319).
          overflow: 'hidden', outline: 'none',
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

export function SalarySheet({
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

  // `plan` is the sync key, not just an initial seed: the planning screen renders
  // from cache and refetches in the background, so the sheet can be opened on a
  // cached salary and have the server's land underneath it. Re-seeding then is
  // what stops a save writing the stale number back.
  useResetOnOpen(open, () => setValue(plan ? String(plan.salary_vnd) : ''), plan)

  async function handleSave() {
    const num = Number(value)
    if (!value || isNaN(num) || num <= 0) { setError(isVI ? 'Vui lòng nhập thu nhập hợp lệ' : 'Please enter a valid income'); return }
    setError('')
    setSaving(true)
    const r = await saveIncome({ planId: plan?.id, month, year, salaryVnd: num })
    if (!r.ok) {
      setError(r.networkError ? (isVI ? 'Lỗi kết nối' : 'Connection error') : (r.error ?? 'Error'))
      setSaving(false)
      return
    }
    if (plan) {
      onRefresh()
      onToast(isVI ? 'Đã lưu thu nhập' : 'Income saved')
    } else {
      onPlanCreated(r.data as MonthlyPlan)
      onToast(isVI ? 'Đã thêm thu nhập' : 'Income set')
    }
    onClose()
    setSaving(false)
  }

  const label = isVI ? (plan ? 'Sửa thu nhập' : 'Thêm thu nhập') : (plan ? 'Edit income' : 'Set income')

  return (
    <Sheet open={open} onClose={onClose} title={label}>
      <div style={{ display: 'grid', gap: 14 }}>
        <label style={{ fontSize: 13, color: 'var(--c-muted)', display: 'block' }}>
          {isVI ? 'Thu nhập tháng (VND)' : 'Monthly income (VND)'}
        </label>
        {error && <p style={{ color: 'var(--c-neg)', fontSize: 13 }}>{error}</p>}
        <input
          type="text"
          inputMode="numeric"
          value={formatIntVN(value)}
          onChange={(e) => setValue(parseIntVN(e.target.value))}
          placeholder="e.g. 45.000.000"
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

export function DeletePlanSheet({
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
    const r = await deletePlan(planId)
    if (r.ok) { onPlanDeleted(); onClose(); onToast(isVI ? 'Đã xoá kế hoạch' : 'Plan deleted') }
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

export function OtherExpenseSheet({
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

  useResetOnOpen(open, () => {
    setDesc(existing?.description ?? '')
    setAmount(existing?.amount_vnd ? String(existing.amount_vnd) : '')
    setError('')
  }, existing)

  async function handleSave() {
    if (!desc.trim()) { setError(isVI ? 'Vui lòng nhập mô tả' : 'Description is required'); return }
    const num = Number(amount)
    if (!amount || isNaN(num) || num <= 0) { setError(isVI ? 'Vui lòng nhập số tiền hợp lệ' : 'Please enter a valid amount'); return }
    setError('')
    setSaving(true)
    const r = await saveOtherExpense({ planId, id: existing?.id, description: desc.trim(), amountVnd: num })
    if (!r.ok) {
      setError(r.networkError ? (isVI ? 'Lỗi kết nối' : 'Connection error') : (r.error ?? 'Error'))
      setSaving(false)
      return
    }
    onRefresh()
    onToast(existing ? (isVI ? 'Đã cập nhật' : 'Updated') : (isVI ? 'Đã thêm' : 'Added'))
    onClose()
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
            {isVI ? 'Số tiền (VND)' : 'Amount (VND)'}
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={formatIntVN(amount)}
            onChange={(e) => setAmount(parseIntVN(e.target.value))}
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

// ─── Main MobilePlanningView ──────────────────────────────────────────────────

export function SimpleOverrideSheet({
  open, onClose, name, defaultAmount, isVI, onSaved,
}: {
  open: boolean
  onClose: () => void
  name: string
  defaultAmount: number
  isVI: boolean
  // The parent owns the single write (and the failure toast); this sheet only
  // collects + validates the amount, then hands it up.
  onSaved: (amount: number) => void | Promise<void>
}) {
  const [value, setValue] = useState(String(defaultAmount))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useResetOnOpen(open, () => { setValue(String(defaultAmount)); setError('') }, defaultAmount)

  async function handleSave() {
    const num = Number(value)
    if (!value || isNaN(num) || num <= 0) { setError(isVI ? 'Vui lòng nhập số tiền hợp lệ' : 'Please enter a valid amount'); return }
    setError('')
    setSaving(true)
    try { await onSaved(num) } finally { setSaving(false) }
  }

  return (
    <Sheet open={open} onClose={onClose} title={isVI ? 'Ghi đè số tiền' : 'Override amount'}>
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ fontSize: 13, color: 'var(--c-muted)' }}>{name}</div>
        {error && <p style={{ color: 'var(--c-neg)', fontSize: 13 }}>{error}</p>}
        <input
          type="text"
          inputMode="numeric"
          value={formatIntVN(value)}
          onChange={(e) => setValue(parseIntVN(e.target.value))}
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
