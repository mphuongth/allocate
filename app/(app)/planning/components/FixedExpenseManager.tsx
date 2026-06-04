'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Plus, ChevronLeft } from 'lucide-react'
import { fmt, fmtCompact } from '@/lib/formatters'

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
function toMonthInput(date: string | null): string {
  return date ? date.slice(0, 7) : ''
}

const SHORT_MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SHORT_MONTHS_VI = ['Th1', 'Th2', 'Th3', 'Th4', 'Th5', 'Th6', 'Th7', 'Th8', 'Th9', 'Th10', 'Th11', 'Th12']

function periodLabel(e: Expense, isVI: boolean): string {
  if (!e.effective_from && !e.effective_to) return isVI ? 'Luôn áp dụng' : 'Always'
  const months = isVI ? SHORT_MONTHS_VI : SHORT_MONTHS_EN
  const fmtMonth = (d: string | null) => {
    if (!d) return null
    const [y, m] = d.split('-').map(Number)
    return `${months[m - 1]} ${y}`
  }
  return `${fmtMonth(e.effective_from) || '…'} → ${fmtMonth(e.effective_to) || '∞'}`
}

const emptyForm = { expense_name: '', amount_vnd: '', category: '', effective_from: '', effective_to: '' }

// ─── Inline style tokens (work in both the desktop modal and mobile sheet) ──────

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', fontSize: 14,
  border: '1px solid var(--c-line)', borderRadius: 10,
  background: 'var(--c-card-2)', color: 'var(--c-ink)', boxSizing: 'border-box',
}
const labelStyle: React.CSSProperties = { fontSize: 13, color: 'var(--c-muted)', display: 'block', marginBottom: 4 }
const ghostBtn: React.CSSProperties = {
  flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid var(--c-line)',
  background: 'var(--c-card)', color: 'var(--c-ink)', fontSize: 14, fontWeight: 500,
  cursor: 'pointer', fontFamily: 'inherit',
}
const primaryBtn: React.CSSProperties = {
  flex: 2, padding: '10px 0', borderRadius: 10, border: 'none',
  background: 'var(--c-btn-primary)', color: '#fff', fontSize: 14, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit',
}

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
      const res = await fetch(`/api/v1/fixed-expenses/${e.expense_id}`, { method: 'DELETE' })
      if (res.ok) {
        setConfirmDelete(null)
        onToast?.(t('deleted'))
        await fetchList()
        onChange()
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
            value={form.amount_vnd ? Number(form.amount_vnd).toLocaleString('en-US') : ''}
            onChange={(e) => setForm({ ...form, amount_vnd: e.target.value.replace(/,/g, '').replace(/[^0-9]/g, '') })}
            placeholder={t('amountPlaceholder')}
            style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums' }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 10 }}>
          <div>
            <label htmlFor="fe-from" style={labelStyle}>{t('effectiveFromLabel')}</label>
            <input
              id="fe-from"
              data-testid="fe-from"
              type="month"
              value={form.effective_from}
              onChange={(e) => setForm({ ...form, effective_from: e.target.value })}
              style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums', minWidth: 0 }}
            />
          </div>
          <div>
            <label htmlFor="fe-to" style={labelStyle}>{t('effectiveToLabel')}</label>
            <input
              id="fe-to"
              data-testid="fe-to"
              type="month"
              value={form.effective_to}
              onChange={(e) => setForm({ ...form, effective_to: e.target.value })}
              style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums', minWidth: 0 }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button type="button" onClick={() => setMode('list')} style={ghostBtn}>{tc('cancel')}</button>
          <button type="button" data-testid="fe-save" onClick={handleSave} disabled={saving} style={{ ...primaryBtn, opacity: saving ? 0.7 : 1 }}>
            {saving ? tc('saving') : tc('save')}
          </button>
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
                  {fmt(e.amount_vnd)} · {periodLabel(e, isVI)}
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

      {confirmDelete && (() => {
        const body = (
          <>
            <div style={{ fontSize: 13, color: 'var(--c-muted)' }}>
              {confirmDelete.expense_name} — {fmtCompact(confirmDelete.amount_vnd)}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => setConfirmDelete(null)} style={ghostBtn}>{tc('cancel')}</button>
              <button
                type="button"
                data-testid="fe-delete-confirm"
                onClick={() => handleDelete(confirmDelete)}
                disabled={deleting}
                style={{ flex: 2, padding: '10px 0', borderRadius: 10, border: 'none', background: 'var(--c-neg)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: deleting ? 0.7 : 1 }}
              >
                {isVI ? 'Xoá' : 'Delete'}
              </button>
            </div>
          </>
        )

        if (variant === 'sheet') {
          // Bottom-anchored sheet so it sits on the phone frame (mirrors the
          // mobile plan's bottom sheets) instead of floating mid-screen.
          return (
            <div
              data-testid="fe-delete-overlay"
              style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'flex-end' }}
              onClick={() => !deleting && setConfirmDelete(null)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ width: '100%', background: 'var(--c-card)', borderRadius: '16px 16px 0 0', paddingBottom: 'env(safe-area-inset-bottom,0)', animation: 'slide-up 220ms cubic-bezier(0.2,0.8,0.2,1)' }}
              >
                <div style={{ width: 36, height: 4, background: 'var(--c-line-strong)', borderRadius: 999, margin: '8px auto 0' }} />
                <div style={{ padding: '14px 16px 0' }}>
                  <p style={{ fontWeight: 700, fontSize: 16, color: 'var(--c-ink)', margin: '0 0 16px' }}>{t('deleteModal')}</p>
                </div>
                <div style={{ padding: '0 16px 24px', display: 'grid', gap: 16 }}>{body}</div>
              </div>
            </div>
          )
        }

        return (
          <div
            data-testid="fe-delete-overlay"
            style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
            onClick={() => !deleting && setConfirmDelete(null)}
          >
            <div onClick={(e) => e.stopPropagation()} style={{ width: 360, maxWidth: '100%', background: 'var(--c-card)', borderRadius: 14, padding: 20, boxShadow: '0 20px 50px rgba(15,23,42,0.25)', display: 'grid', gap: 16 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-ink)' }}>{t('deleteModal')}</div>
              {body}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
