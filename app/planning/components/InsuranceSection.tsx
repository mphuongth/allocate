'use client'

import { useState } from 'react'
import type { MonthlyPlan, InsuranceMember } from '../PlanningClient'

interface Props {
  plan: MonthlyPlan
  insuranceMembers: InsuranceMember[]
  onRefresh: () => void
  onToast: (msg: string) => void
}

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')

const inputCls = 'w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500'

export default function InsuranceSection({ plan, insuranceMembers, onRefresh, onToast }: Props) {
  const [editItem, setEditItem] = useState<InsuranceMember | null>(null)
  const [form, setForm] = useState({ member_name: '', relationship: '', annual_payment_vnd: '', payment_date: '' })
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmSkip, setConfirmSkip] = useState<InsuranceMember | null>(null)

  function openEdit(member: InsuranceMember) {
    setEditItem(member)
    setForm({
      member_name: member.member_name,
      relationship: member.relationship,
      annual_payment_vnd: String(member.annual_payment_vnd),
      payment_date: member.payment_date ?? '',
    })
    setFormError('')
  }

  async function handleSave() {
    if (!editItem) return
    setFormError('')
    if (!form.member_name.trim()) { setFormError('Member name is required'); return }
    if (!form.relationship.trim()) { setFormError('Relationship is required'); return }
    if (!form.annual_payment_vnd || Number(form.annual_payment_vnd) <= 0) { setFormError('Annual payment must be positive'); return }

    setSaving(true)
    try {
      const res = await fetch(`/api/v1/insurance-members/${editItem.member_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member_name: form.member_name.trim(),
          relationship: form.relationship.trim(),
          annual_payment_vnd: Number(form.annual_payment_vnd),
          payment_date: form.payment_date || null,
        }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        setFormError(error ?? 'Something went wrong. Please try again later.')
      } else {
        setEditItem(null)
        onToast('Insurance member updated')
        onRefresh()
      }
    } catch {
      setFormError('Unable to save. Please check your connection and try again.')
    }
    setSaving(false)
  }

  async function handleSkip(member: InsuranceMember) {
    await fetch(`/api/v1/monthly-plans/${plan.id}/excluded-insurance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_id: member.member_id }),
    })
    setConfirmSkip(null)
    onToast(`${member.member_name} skipped for this month`)
    onRefresh()
  }

  async function handleRestore(member: InsuranceMember) {
    await fetch(`/api/v1/monthly-plans/${plan.id}/excluded-insurance/${member.member_id}`, { method: 'DELETE' })
    onToast(`${member.member_name} restored`)
    onRefresh()
  }

  if (insuranceMembers.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Insurance</h2>
        </div>
        <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">No insurance members configured</div>
      </div>
    )
  }

  const totalMonthly = insuranceMembers.reduce((sum, m) => {
    if (m.excluded) return sum
    return sum + Math.round(m.annual_payment_vnd / 12)
  }, 0)

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Insurance</h2>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Monthly premiums (annual ÷ 12). Skip for this month only.</p>
      </div>

      <table className="w-full text-sm">
        <thead className="bg-gray-50 dark:bg-gray-800">
          <tr>
            {['Member', 'Relationship', 'Monthly Premium', 'Actions'].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {insuranceMembers.map((m) => (
            <tr key={m.member_id} className={`hover:bg-gray-50 dark:hover:bg-gray-800 ${m.excluded ? 'opacity-60' : ''}`}>
              <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{m.member_name}</td>
              <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{m.relationship}</td>
              <td className="px-4 py-3">
                {m.excluded ? (
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                    Skipped
                  </span>
                ) : (
                  <span className="text-gray-700 dark:text-gray-300">{fmt(Math.round(m.annual_payment_vnd / 12))}</span>
                )}
              </td>
              <td className="px-4 py-3">
                <div className="flex gap-3">
                  {m.excluded ? (
                    <button onClick={() => handleRestore(m)} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Restore</button>
                  ) : (
                    <>
                      <button onClick={() => openEdit(m)} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Edit</button>
                      <button onClick={() => setConfirmSkip(m)} className="text-xs text-red-500 dark:text-red-400 hover:underline">Delete</button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <td colSpan={2} className="px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-300">Total Monthly</td>
            <td colSpan={2} className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100">{fmt(totalMonthly)}</td>
          </tr>
        </tfoot>
      </table>

      {/* Edit Modal */}
      {editItem && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm p-6 border border-gray-100 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Edit Insurance Member</h3>
            {formError && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{formError}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Member Name *</label>
                <input type="text" value={form.member_name} onChange={(e) => setForm({ ...form, member_name: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Relationship *</label>
                <input type="text" value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Annual Payment (VND) *</label>
                <input type="number" value={form.annual_payment_vnd} onChange={(e) => setForm({ ...form, annual_payment_vnd: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Payment Date</label>
                <input type="date" value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })} className={inputCls} />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setEditItem(null)} className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Skip Confirmation */}
      {confirmSkip && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm p-6 border border-gray-100 dark:border-gray-700">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">Skip this month?</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-5">
              <strong>{confirmSkip.member_name}</strong> will be excluded from this month's plan only. Settings and other months are not affected.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmSkip(null)} className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
              <button onClick={() => handleSkip(confirmSkip)} className="flex-1 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700">Skip</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
