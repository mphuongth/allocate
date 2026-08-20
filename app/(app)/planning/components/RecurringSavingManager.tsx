'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { toast } from 'sonner'
import { Plus, ChevronLeft } from 'lucide-react'
import { fmt, fmtCompact } from '@/lib/formatters'
import { formatIntVN, parseIntVN } from '@/lib/numberFormat'
import EffectiveMonthFields from './EffectiveMonthFields'
import PlanningDeleteConfirm from './PlanningDeleteConfirm'
import { ghostBtn, inputStyle, labelStyle, monthRangeLabel, primaryBtn, toMonthInput } from './planningManagerShell'
import type { Goal } from '@/features/planning/contracts'

interface Saving {
  saving_id: string
  name: string
  goal_id: string | null
  amount_vnd: number
  effective_from: string | null
  effective_to: string | null
  linked_deposit_tx_id: string | null
  savings_goals?: { goal_name: string } | null
}

// A deposit a recurring saving can be hard-linked to. Either a single TERM
// deposit (folded in when it matures — the combine flow) or an accumulating BOOK
// (topped up each month — auto top-up). For a book the target is its anchor row
// (deposit_group_id = transaction_id); non-anchor tranches aren't link targets.
interface LinkTarget {
  transaction_id: string
  goal_id: string | null
  notes: string | null
  expiry_date: string | null
  kind: 'term' | 'book'
}

// "2026-04-01" → "2026-04" for <input type="month">


const emptyForm = { name: '', goal_id: '', amount_vnd: '', effective_from: '', effective_to: '', linked_deposit_tx_id: '' }


interface Props {
  goals: Goal[]
  onChange: () => void
  onToast?: (msg: string) => void
  variant?: 'modal' | 'sheet'
  // When set, open straight on this saving's edit form (deep-link from a plan
  // line's "Edit recurring plan") instead of the list.
  editSavingId?: string | null
}

export default function RecurringSavingManager({ goals, onChange, onToast, variant = 'modal', editSavingId }: Props) {
  const tc = useTranslations('common')
  const isVI = useLocale() === 'vi'

  const [items, setItems] = useState<Saving[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<'list' | 'form'>('list')
  const [editing, setEditing] = useState<Saving | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Saving | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deposits, setDeposits] = useState<LinkTarget[]>([])

  const unallocatedLabel = isVI ? 'Chưa phân bổ (đầu tư chung)' : 'Unallocated (general)'

  const fetchList = useCallback(async () => {
    const res = await fetch('/api/v1/recurring-savings')
    const data = res.ok ? await res.json() : { savings: [] }
    const list: Saving[] = data.savings ?? []
    setItems(list)
    setLoading(false)
    // Deep-link: open straight into the edit form for the requested saving once
    // its data has loaded. (setState here runs after the await, not synchronously
    // in an effect, so it doesn't cascade-render the list first.)
    if (editSavingId) {
      const item = list.find((s) => s.saving_id === editSavingId)
      if (item) {
        setEditing(item)
        setForm({
          name: item.name,
          goal_id: item.goal_id ?? '',
          amount_vnd: String(item.amount_vnd),
          effective_from: toMonthInput(item.effective_from),
          effective_to: toMonthInput(item.effective_to),
          linked_deposit_tx_id: item.linked_deposit_tx_id ?? '',
        })
        setFormError('')
        setMode('form')
      }
    }
  }, [editSavingId])

  useEffect(() => { fetchList() }, [fetchList])

  // Deposits available to link to — bank holdings with a rate + maturity. A
  // single term deposit (combine at maturity) or an accumulating book's ANCHOR
  // (auto top-up). Non-anchor book tranches are excluded: link the book via its
  // anchor (deposit_group_id = transaction_id).
  useEffect(() => {
    fetch('/api/v1/investment-transactions?asset_type=bank&limit=200')
      .then((r) => (r.ok ? r.json() : { transactions: [] }))
      .then((data: { transactions?: Array<LinkTarget & { interest_rate: number | null; transaction_type: string; deposit_group_id: string | null }> }) => {
        setDeposits((data.transactions ?? [])
          .filter((t) => t.transaction_type === 'investment' && t.interest_rate != null && !!t.expiry_date)
          // Term deposit (ungrouped) or a book anchor (group = its own id); drop tranches.
          .filter((t) => t.deposit_group_id == null || t.deposit_group_id === t.transaction_id)
          .map((t) => ({
            transaction_id: t.transaction_id, goal_id: t.goal_id, notes: t.notes, expiry_date: t.expiry_date,
            kind: t.deposit_group_id != null ? 'book' as const : 'term' as const,
          })))
      })
      .catch(() => {})
  }, [])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setFormError('')
    setMode('form')
  }

  function openEdit(s: Saving) {
    setEditing(s)
    setForm({
      name: s.name,
      goal_id: s.goal_id ?? '',
      amount_vnd: String(s.amount_vnd),
      effective_from: toMonthInput(s.effective_from),
      effective_to: toMonthInput(s.effective_to),
      linked_deposit_tx_id: s.linked_deposit_tx_id ?? '',
    })
    setFormError('')
    setMode('form')
  }

  async function handleSave() {
    setFormError('')
    if (!form.name.trim()) { setFormError(isVI ? 'Cần nhập tên' : 'Name is required'); return }
    if (!form.amount_vnd || Number(form.amount_vnd) <= 0) { setFormError(isVI ? 'Cần nhập số tiền' : 'Amount is required'); return }

    setSaving(true)
    try {
      const url = editing ? `/api/v1/recurring-savings/${editing.saving_id}` : '/api/v1/recurring-savings'
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          goal_id: form.goal_id || null,
          amount_vnd: Number(form.amount_vnd),
          effective_from: form.effective_from || null,
          effective_to: form.effective_to || null,
          linked_deposit_tx_id: form.linked_deposit_tx_id || null,
        }),
      })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: '' }))
        setFormError(error || tc('error'))
        return
      }
      onToast?.(editing ? (isVI ? 'Đã cập nhật' : 'Updated') : (isVI ? 'Đã thêm khoản định kỳ' : 'Recurring saving added'))
      setMode('list')
      await fetchList()
      onChange()
    } catch {
      setFormError(tc('error'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(s: Saving) {
    setDeleting(true)
    try {
      const res = await fetch(`/api/v1/recurring-savings/${s.saving_id}`, { method: 'DELETE' }).catch(() => null)
      if (res?.ok) {
        setConfirmDelete(null)
        onToast?.(isVI ? 'Đã xoá khoản' : 'Saving deleted')
        await fetchList()
        onChange()
      } else {
        toast.error(isVI ? 'Không thể xoá, vui lòng thử lại' : "Couldn't delete — please try again")
      }
    } finally {
      setDeleting(false)
    }
  }

  const goalName = (id: string | null, fallback?: string | null) =>
    id ? (goals.find(g => g.goal_id === id)?.goal_name ?? fallback ?? id) : (isVI ? 'Chưa phân bổ' : 'Unallocated')

  // ─── Form view ──────────────────────────────────────────────────────────────

  if (mode === 'form') {
    return (
      <div data-testid="recurring-saving-manager" style={{ display: 'grid', gap: 14 }}>
        <button
          type="button"
          onClick={() => setMode('list')}
          style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px', fontSize: 12, color: 'var(--c-muted)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          <ChevronLeft size={14} />{isVI ? 'Danh sách' : 'Back to list'}
        </button>

        {formError && <p style={{ color: 'var(--c-neg)', fontSize: 13, margin: 0 }}>{formError}</p>}

        <div>
          <label htmlFor="rs-goal" style={labelStyle}>{isVI ? 'Phân bổ vào' : 'Allocate to'}</label>
          <select
            id="rs-goal"
            data-testid="rs-goal"
            value={form.goal_id}
            onChange={(e) => setForm({ ...form, goal_id: e.target.value, linked_deposit_tx_id: '' })}
            style={{ ...inputStyle, appearance: 'none', cursor: 'pointer' }}
          >
            {goals.map((g) => <option key={g.goal_id} value={g.goal_id}>{g.goal_name}</option>)}
            <option value="">{unallocatedLabel}</option>
          </select>
        </div>

        {(() => {
          // Deposits in the same goal as this recurring — the only valid link
          // targets. Hidden when there are none to link.
          const linkable = deposits.filter((d) => (d.goal_id ?? null) === (form.goal_id || null))
          if (linkable.length === 0) return null
          const selected = linkable.find((d) => d.transaction_id === form.linked_deposit_tx_id)
          // The link means different things per target: a term deposit folds this
          // recurring in at maturity; a book gets topped up by it each month.
          const hint = selected?.kind === 'book'
            ? (isVI ? 'Mỗi tháng, nút “Đã gửi” sẽ nạp khoản này vào sổ tích luỹ đó.' : 'Each month, “Saved” tops this amount into that accumulating book.')
            : selected?.kind === 'term'
              ? (isVI ? 'Khi sổ này đáo hạn, khoản định kỳ sẽ được gộp đúng vào sổ đó.' : 'When that deposit matures, this recurring is the one folded into it.')
              : (isVI ? 'Sổ kỳ hạn: gộp khi đáo hạn. Sổ tích luỹ: nạp thêm mỗi tháng.' : 'Term deposit: folded in at maturity. Accumulating book: topped up monthly.')
          return (
            <div>
              <label htmlFor="rs-deposit" style={labelStyle}>{isVI ? 'Gắn với sổ tiết kiệm (tuỳ chọn)' : 'Link to a deposit (optional)'}</label>
              <select
                id="rs-deposit"
                data-testid="rs-deposit"
                value={form.linked_deposit_tx_id}
                onChange={(e) => setForm({ ...form, linked_deposit_tx_id: e.target.value })}
                style={{ ...inputStyle, appearance: 'none', cursor: 'pointer' }}
              >
                <option value="">{isVI ? 'Không gắn' : 'Not linked'}</option>
                {linkable.map((d) => {
                  const tag = d.kind === 'book' ? (isVI ? 'Tích luỹ' : 'Auto top-up') : (isVI ? 'Đáo hạn' : 'At maturity')
                  return (
                    <option key={d.transaction_id} value={d.transaction_id}>
                      {(d.notes || (isVI ? 'Sổ ngân hàng' : 'Bank deposit')) + ` · ${tag}` + (d.expiry_date ? ` · ${d.expiry_date}` : '')}
                    </option>
                  )
                })}
              </select>
              <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 4 }}>{hint}</div>
            </div>
          )
        })()}

        <div>
          <label htmlFor="rs-name" style={labelStyle}>{isVI ? 'Ngân hàng / sản phẩm' : 'Bank / product'}</label>
          <input
            id="rs-name"
            data-testid="rs-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={isVI ? 'VD. VCB Tiết kiệm' : 'e.g. VCB Savings'}
            style={inputStyle}
            autoFocus
          />
        </div>

        <div>
          <label htmlFor="rs-amount" style={labelStyle}>{isVI ? 'Số tiền hàng tháng (VND)' : 'Monthly amount (VND)'}</label>
          <input
            id="rs-amount"
            data-testid="rs-amount"
            type="text"
            inputMode="numeric"
            value={formatIntVN(form.amount_vnd)}
            onChange={(e) => setForm({ ...form, amount_vnd: parseIntVN(e.target.value) })}
            placeholder="0"
            style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums' }}
          />
        </div>

        <EffectiveMonthFields
          idPrefix="rs"
          fromLabel={isVI ? 'Bắt đầu từ' : 'Effective from'}
          toLabel={isVI ? 'Kết thúc' : 'Effective to'}
          from={form.effective_from}
          to={form.effective_to}
          onFromChange={(v) => setForm({ ...form, effective_from: v })}
          onToChange={(v) => setForm({ ...form, effective_to: v })}
        />

        <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: -4 }}>
          {isVI ? 'Tự động lặp lại mỗi tháng. Bỏ trống ngày kết thúc để áp dụng vô thời hạn.' : 'Auto-repeats every month. Leave end blank to apply indefinitely.'}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button type="button" onClick={() => setMode('list')} style={ghostBtn}>{tc('cancel')}</button>
          <button type="button" data-testid="rs-save" onClick={handleSave} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.7 : 1 }}>
            {saving ? tc('saving') : tc('save')}
          </button>
        </div>
      </div>
    )
  }

  // ─── List view ──────────────────────────────────────────────────────────────

  const total = items.reduce((s, e) => s + e.amount_vnd, 0)

  return (
    <div data-testid="recurring-saving-manager" style={{ display: 'grid', gap: 12 }}>
      {!loading && items.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--c-muted)' }}>
          {items.length} {isVI ? 'khoản' : items.length === 1 ? 'item' : 'items'} · {fmt(total)}/{isVI ? 'tháng' : 'mo'}
        </div>
      )}

      <div style={{ display: 'grid', gap: 8, maxHeight: 360, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: '24px 12px', textAlign: 'center', fontSize: 13, color: 'var(--c-muted)' }}>{tc('loading')}</div>
        ) : items.length === 0 ? (
          <div style={{ padding: '24px 12px', textAlign: 'center', fontSize: 13, color: 'var(--c-muted)', border: '1px dashed var(--c-line-strong)', borderRadius: 10 }}>
            {isVI ? 'Chưa có khoản tiết kiệm định kỳ.' : 'No recurring savings yet.'}
          </div>
        ) : (
          items.map((s) => (
            <div
              key={s.saving_id}
              data-testid={`rs-row-${s.saving_id}`}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', borderRadius: 10, border: '1px solid var(--c-line)', background: 'var(--c-card)' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 999, color: 'var(--c-navy)', background: 'var(--c-navy-tint)', flexShrink: 0 }}>
                    {goalName(s.goal_id, s.savings_goals?.goal_name)}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(s.amount_vnd)} · {monthRangeLabel(s.effective_from, s.effective_to, isVI, isVI ? 'Hàng tháng' : 'Every month')}
                </div>
              </div>
              <button
                type="button"
                data-testid="rs-edit"
                aria-label="Edit"
                onClick={() => openEdit(s)}
                style={{ padding: 6, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, color: 'var(--c-muted)', display: 'flex' }}
              >
                <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4l10-10-4-4L4 16z" /></svg>
              </button>
              <button
                type="button"
                data-testid="rs-delete"
                aria-label="Delete"
                onClick={() => setConfirmDelete(s)}
                style={{ padding: 6, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, color: 'var(--c-neg)', display: 'flex' }}
              >
                <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
              </button>
            </div>
          ))
        )}
      </div>

      <button
        type="button"
        data-testid="rs-add"
        onClick={openCreate}
        style={{ ...primaryBtn, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px' }}
      >
        <Plus size={15} strokeWidth={2.4} />{isVI ? 'Thêm khoản định kỳ' : 'Add recurring saving'}
      </button>

      {confirmDelete && (
        <PlanningDeleteConfirm
          variant={variant}
          testIdPrefix="rs"
          title={isVI ? 'Xoá khoản định kỳ?' : 'Delete recurring saving?'}
          description={`${confirmDelete.name} — ${fmtCompact(confirmDelete.amount_vnd)}`}
          cancelLabel={tc('cancel')}
          confirmLabel={isVI ? 'Xoá' : 'Delete'}
          deleting={deleting}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => handleDelete(confirmDelete)}
        />
      )}
    </div>
  )
}
