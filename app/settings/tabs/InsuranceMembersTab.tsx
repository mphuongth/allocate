'use client'

import { useState, useEffect, useCallback } from 'react'

interface InsuranceMember {
  member_id: string
  member_name: string
  relationship: string
  annual_payment_vnd: number
  monthly_premium_vnd: number
  payment_date: string | null
  created_at: string
}

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')

const emptyForm = { member_name: '', relationship: '', annual_payment_vnd: '', payment_date: '' }

export default function InsuranceMembersTab() {
  const [members, setMembers] = useState<InsuranceMember[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editMember, setEditMember] = useState<InsuranceMember | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')

  const fetchMembers = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/v1/insurance-members')
    const { members } = await res.json()
    setMembers(members ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchMembers() }, [fetchMembers])

  function openCreate() {
    setEditMember(null)
    setForm(emptyForm)
    setFormError('')
    setShowForm(true)
  }

  function openEdit(member: InsuranceMember) {
    setEditMember(member)
    setForm({
      member_name: member.member_name,
      relationship: member.relationship,
      annual_payment_vnd: String(member.annual_payment_vnd),
      payment_date: member.payment_date ?? '',
    })
    setFormError('')
    setShowForm(true)
  }

  async function handleSave() {
    setFormError('')
    if (!form.member_name.trim()) { setFormError('Member name is required.'); return }
    if (!form.relationship.trim()) { setFormError('Relationship is required.'); return }
    if (!form.annual_payment_vnd || Number(form.annual_payment_vnd) <= 0) { setFormError('Annual payment must be greater than 0.'); return }

    setSaving(true)
    const url = editMember ? `/api/v1/insurance-members/${editMember.member_id}` : '/api/v1/insurance-members'
    const res = await fetch(url, {
      method: editMember ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        member_name: form.member_name,
        relationship: form.relationship,
        annual_payment_vnd: Number(form.annual_payment_vnd),
        payment_date: form.payment_date || null,
      }),
    })
    if (!res.ok) {
      const { error } = await res.json()
      setFormError(error ?? 'Something went wrong.')
    } else {
      setShowForm(false)
      await fetchMembers()
    }
    setSaving(false)
  }

  async function handleDelete(member: InsuranceMember) {
    if (!confirm(`Delete "${member.member_name}"?`)) return
    const res = await fetch(`/api/v1/insurance-members/${member.member_id}`, { method: 'DELETE' })
    if (res.ok) {
      setSuccessMsg('Member deleted.')
      setTimeout(() => setSuccessMsg(''), 4000)
      await fetchMembers()
    }
  }

  const totalAnnual = members.reduce((s, m) => s + m.annual_payment_vnd, 0)
  const totalMonthly = members.reduce((s, m) => s + m.monthly_premium_vnd, 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Insurance Members</h2>
          {members.length > 0 && (
            <p className="text-sm text-gray-500 mt-0.5">
              Total: {fmt(totalAnnual)} / year · {fmt(totalMonthly)} / month
            </p>
          )}
        </div>
        <button onClick={openCreate} className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700">
          Add Member
        </button>
      </div>

      {successMsg && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-800 rounded-lg text-sm">{successMsg}</div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="text-center py-10 text-gray-400 text-sm">Loading...</div>
        ) : members.length === 0 ? (
          <div className="text-center py-10 text-gray-400 text-sm">No insurance members yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {['Member', 'Relationship', 'Annual Payment', 'Monthly Premium', 'Payment Date', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {members.map((member) => (
                <tr key={member.member_id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{member.member_name}</td>
                  <td className="px-4 py-3">
                    <span className="inline-block px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs font-medium">{member.relationship}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{fmt(member.annual_payment_vnd)}</td>
                  <td className="px-4 py-3 font-medium text-indigo-600">{fmt(member.monthly_premium_vnd)}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {member.payment_date ? new Date(member.payment_date).toLocaleDateString('vi-VN') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-3">
                      <button onClick={() => openEdit(member)} className="text-xs text-indigo-600 hover:underline">Edit</button>
                      <button onClick={() => handleDelete(member)} className="text-xs text-red-500 hover:underline">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{editMember ? 'Edit Member' : 'Add Member'}</h3>
            {formError && <p className="text-red-600 text-sm mb-3">{formError}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Member Name *</label>
                <input type="text" value={form.member_name} onChange={(e) => setForm({ ...form, member_name: e.target.value })}
                  placeholder="e.g. John" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Relationship *</label>
                <input type="text" value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })}
                  placeholder="e.g. Spouse, Child, Self" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Annual Payment (VND) *</label>
                <input type="number" value={form.annual_payment_vnd} onChange={(e) => setForm({ ...form, annual_payment_vnd: e.target.value })}
                  placeholder="e.g. 12000000" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                {form.annual_payment_vnd && Number(form.annual_payment_vnd) > 0 && (
                  <p className="text-xs text-gray-400 mt-1">Monthly: {fmt(Math.round(Number(form.annual_payment_vnd) / 12))}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Date</label>
                <input type="date" value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
