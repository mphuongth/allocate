'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { toast } from 'sonner'
import { Plus, ChevronLeft } from 'lucide-react'
import { fmt, fmtCompact } from '@/lib/formatters'
import { formatIntVN, parseIntVN } from '@/lib/numberFormat'
import EffectiveMonthFields from './EffectiveMonthFields'
import PlanningDeleteConfirm from './PlanningDeleteConfirm'
import PendingButton from '@/components/ui/PendingButton'
import { ghostBtn, inputStyle, labelStyle, monthRangeLabel, primaryBtn, toMonthInput } from './planningManagerShell'

// Master fixed-expense definitions. Categories mirror the Settings tab and the
// API's accepted values; labels are localised for display only.
const CATEGORIES = ['Housing', 'Utilities', 'Transportation', 'Insurance', 'Parents', 'Education', 'Subscriptions', 'Other'] as const
const CATEGORIES_VI: Record<string, string> = {
  Housing: 'Nhà ở', Utilities: 'Tiện ích', Transportation: 'Đi lại', Insurance: 'Bảo hiểm',
  Parents: 'Cha mẹ', Education: 'Giáo dục', Subscriptions: 'Đăng ký', Other: 'Khác',
}
const CATEGORY_COLORS: Record<string, string> = {
  Housing: '#b45309', Utilities: '#0369a1', Transportation: '#4338ca', Insurance: '#7c3aed',
  Parents: '#be185d', Education: '#047857', Subscriptions: '#0d9488', Other: '#475569',
}

interface Expense {
  expense_id: string
  expense_name: string
  amount_vnd: number
  category: string
  effective_from: string | null
  effective_to: string | null
}

// "2026-04-01" → "2026-04" for <input type="month">


const emptyForm = { expense_name: '', amount_vnd: '', category: '', effective_from: '', effective_to: '' }


interface Props {
  onChange: () => void
  onToast?: (msg: string) => void
  // Controls how the delete confirmation is presented: a centered card for the
  // desktop modal, or a bottom-anchored sheet for the mobile bottom sheet.
  variant?: 'modal' | 'sheet'
}

export default function FixedExpenseManager({ onChange, onToast, variant = 'modal' }: Props) {
  const t = useTranslations('expenses')
  const tc = useTranslations('common')
  const isVI = useLocale() === 'vi'

  const [items, setItems] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<'list' | 'form'>('list')
  const [editing, setEditing] = useState<Expense | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Expense | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchList = useCallback(async () => {
    const res = await fetch('/api/v1/fixed-expenses')
    const data = res.ok ? await res.json() : { expenses: [] }
    setItems(data.expenses ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchList() }, [fetchList])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm)
    setFormError('')
    setMode('form')
  }

  function openEdit(e: Expense) {
    setEditing(e)
    setForm({
      expense_name: e.expense_name,
      amount_vnd: String(e.amount_vnd),
      category: e.category,
      effective_from: toMonthInput(e.effective_from),
      effective_to: toMonthInput(e.effective_to),
    })
    setFormError('')
    setMode('form')
  }

  async function handleSave() {
    setFormError('')
    if (!form.expense_name.trim()) { setFormError(t('nameRequired')); return }
    if (!form.category.trim()) { setFormError(t('categoryRequired')); return }
    if (!form.amount_vnd || Number(form.amount_vnd) <= 0) { setFormError(t('amountRequired')); return }

    setSaving(true)
    try {
      const url = editing ? `/api/v1/fixed-expenses/${editing.expense_id}` : '/api/v1/fixed-expenses'
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expense_name: form.expense_name.trim(),
          amount_vnd: Number(form.amount_vnd),
          category: form.category,
          effective_from: form.effective_from || null,
          effective_to: form.effective_to || null,
        }),
      })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: '' }))
        setFormError(error || tc('error'))
        return
      }
      onToast?.(editing ? (isVI ? 'Đã cập nhật chi phí' : 'Expense updated') : (isVI ? 'Đã thêm chi phí' : 'Expense added'))
      setMode('list')
      await fetchList()
      onChange()
    } catch {
      setFormError(tc('error'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(e: Expense) {
    setDeleting(true)
    try {
      const res = await fetch(`/api/v1/fixed-expenses/${e.expense_id}`, { method: 'DELETE' }).catch(() => null)
      if (res?.ok) {
        setConfirmDelete(null)
        onToast?.(t('deleted'))
        await fetchList()
        onChange()
      } else {
        toast.error(isVI ? 'Không thể xoá, vui lòng thử lại' : "Couldn't delete — please try again")
      }
    } finally {
      setDeleting(false)
    }
  }

  const catLabel = (c: string) => (isVI ? (CATEGORIES_VI[c] || c) : c)

  // ─── Form view ──────────────────────────────────────────────────────────────

  if (mode === 'form') {
    return (
      <div data-testid="fixed-expense-manager" style={{ display: 'grid', gap: 14 }}>
        <button
          type="button"
          onClick={() => setMode('list')}
          style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px', fontSize: 12, color: 'var(--c-muted)', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          <ChevronLeft size={14} />{isVI ? 'Danh sách' : 'Back to list'}
        </button>

        {formError && <p style={{ color: 'var(--c-neg)', fontSize: 13, margin: 0 }}>{formError}</p>}

        <div>
          <label htmlFor="fe-name" style={labelStyle}>{t('nameLabel')}</label>
          <input
            id="fe-name"
            data-testid="fe-name"
            value={form.expense_name}
            onChange={(e) => setForm({ ...form, expense_name: e.target.value })}
            placeholder={t('namePlaceholder')}
            style={inputStyle}
            autoFocus
          />
        </div>

        <div>
          <label htmlFor="fe-category" style={labelStyle}>{t('categoryLabel')}</label>
          <select
            id="fe-category"
            data-testid="fe-category"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            style={{ ...inputStyle, appearance: 'none', cursor: 'pointer' }}
          >
            <option value="" disabled>{t('categoryPlaceholder')}</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{catLabel(c)}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="fe-amount" style={labelStyle}>{t('amountLabel')}</label>
          <input
            id="fe-amount"
            data-testid="fe-amount"
            type="text"
            inputMode="numeric"
            value={formatIntVN(form.amount_vnd)}
            onChange={(e) => setForm({ ...form, amount_vnd: parseIntVN(e.target.value) })}
            placeholder={t('amountPlaceholder')}
            style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums' }}
          />
        </div>

        <EffectiveMonthFields
          idPrefix="fe"
          fromLabel={t('effectiveFromLabel')}
          toLabel={t('effectiveToLabel')}
          from={form.effective_from}
          to={form.effective_to}
          onFromChange={(v) => setForm({ ...form, effective_from: v })}
          onToChange={(v) => setForm({ ...form, effective_to: v })}
        />

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button type="button" onClick={() => setMode('list')} style={ghostBtn}>{tc('cancel')}</button>
          {/* Not dimmed while saving: the fill has to stay behind the loader. */}
          <PendingButton pending={saving} pendingLabel={tc('saving')} data-testid="fe-save" onClick={handleSave} style={{ ...primaryBtn, cursor: saving ? 'default' : 'pointer' }}>
            {tc('save')}
          </PendingButton>
        </div>
      </div>
    )
  }

  // ─── List view ──────────────────────────────────────────────────────────────

  const total = items.reduce((s, e) => s + e.amount_vnd, 0)

  return (
    <div data-testid="fixed-expense-manager" style={{ display: 'grid', gap: 12 }}>
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
            {t('empty')}
          </div>
        ) : (
          items.map((e) => (
            <div
              key={e.expense_id}
              data-testid={`fe-row-${e.expense_id}`}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', borderRadius: 10, border: '1px solid var(--c-line)', background: 'var(--c-card)' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-ink)' }}>{e.expense_name}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 999, color: CATEGORY_COLORS[e.category] || '#475569', background: (CATEGORY_COLORS[e.category] || '#475569') + '1a' }}>
                    {catLabel(e.category)}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(e.amount_vnd)} · {monthRangeLabel(e.effective_from, e.effective_to, isVI, isVI ? 'Luôn áp dụng' : 'Always')}
                </div>
              </div>
              <button
                type="button"
                data-testid="fe-edit"
                aria-label="Edit"
                onClick={() => openEdit(e)}
                style={{ padding: 6, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 6, color: 'var(--c-muted)', display: 'flex' }}
              >
                <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4l10-10-4-4L4 16z" /></svg>
              </button>
              <button
                type="button"
                data-testid="fe-delete"
                aria-label="Delete"
                onClick={() => setConfirmDelete(e)}
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
        data-testid="fe-add"
        onClick={openCreate}
        style={{ ...primaryBtn, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px' }}
      >
        <Plus size={15} strokeWidth={2.4} />{t('create')}
      </button>

      {confirmDelete && (
        <PlanningDeleteConfirm
          deletingLabel={tc('deleting')}
          variant={variant}
          testIdPrefix="fe"
          title={t('deleteModal')}
          description={`${confirmDelete.expense_name} — ${fmtCompact(confirmDelete.amount_vnd)}`}
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
