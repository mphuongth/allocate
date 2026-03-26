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
  const [deletingId, setDeletingId] = useState<string | null>(null)
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
    if (!form.member_name.trim()) { setFormError('Tên thành viên là bắt buộc.'); return }
    if (!form.relationship.trim()) { setFormError('Quan hệ là bắt buộc.'); return }
    if (!form.annual_payment_vnd || Number(form.annual_payment_vnd) <= 0) { setFormError('Phí hàng năm phải lớn hơn 0.'); return }

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
      setFormError(error ?? 'Đã xảy ra lỗi.')
    } else {
      setShowForm(false)
      await fetchMembers()
    }
    setSaving(false)
  }

  async function handleDelete(member: InsuranceMember) {
    if (!confirm(`Xóa "${member.member_name}"?`)) return
    setDeletingId(member.member_id)
    const res = await fetch(`/api/v1/insurance-members/${member.member_id}`, { method: 'DELETE' })
    if (res.ok) {
      setSuccessMsg('Đã xóa thành viên.')
      setTimeout(() => setSuccessMsg(''), 4000)
      await fetchMembers()
    }
    setDeletingId(null)
  }

  const totalAnnual = members.reduce((s, m) => s + m.annual_payment_vnd, 0)
  const totalMonthly = members.reduce((s, m) => s + m.monthly_premium_vnd, 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Thành viên Bảo hiểm</h2>
          {members.length > 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Tổng: {fmt(totalAnnual)} / năm · {fmt(totalMonthly)} / tháng
            </p>
          )}
        </div>
        <button onClick={openCreate} className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700">
          Thêm Thành viên
        </button>
      </div>

      {successMsg && (
        <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-300 rounded-lg text-sm">{successMsg}</div>
      )}

      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {loading ? (
          <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">Đang tải...</div>
        ) : members.length === 0 ? (
          <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">Chưa có thành viên bảo hiểm.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                {['Thành viên', 'Quan hệ', 'Phí hàng năm', 'Phí hàng tháng', 'Ngày thanh toán', 'Thao tác'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {members.map((member) => (
                <tr key={member.member_id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{member.member_name}</td>
                  <td className="px-4 py-3">
                    <span className="inline-block px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-medium">{member.relationship}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{fmt(member.annual_payment_vnd)}</td>
                  <td className="px-4 py-3 font-medium text-indigo-600 dark:text-indigo-400">{fmt(member.monthly_premium_vnd)}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400">
                    {member.payment_date ? new Date(member.payment_date).toLocaleDateString('vi-VN') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-3">
                      <button onClick={() => openEdit(member)} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">Sửa</button>
                      <button onClick={() => handleDelete(member)} disabled={deletingId === member.member_id} className="text-xs text-red-500 dark:text-red-400 hover:underline disabled:opacity-50">
                        {deletingId === member.member_id ? 'Đang xóa...' : 'Xóa'}
                      </button>
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
          <form onSubmit={(e) => { e.preventDefault(); handleSave() }} className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm p-6 border border-gray-100 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{editMember ? 'Sửa Thành viên' : 'Thêm Thành viên'}</h3>
            {formError && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{formError}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tên Thành viên *</label>
                <input type="text" value={form.member_name} onChange={(e) => setForm({ ...form, member_name: e.target.value })}
                  placeholder="VD: Nguyễn Văn A" className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Quan hệ *</label>
                <input type="text" value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })}
                  placeholder="VD: Vợ/Chồng, Con, Bản thân" className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phí hàng năm (VND) *</label>
                <input type="number" value={form.annual_payment_vnd} onChange={(e) => setForm({ ...form, annual_payment_vnd: e.target.value })}
                  placeholder="VD: 12000000" className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                {form.annual_payment_vnd && Number(form.annual_payment_vnd) > 0 && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Hàng tháng: {fmt(Math.round(Number(form.annual_payment_vnd) / 12))}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Ngày Thanh toán</label>
                <input type="date" value={form.payment_date} onChange={(e) => setForm({ ...form, payment_date: e.target.value })}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Hủy</button>
              <button type="submit" disabled={saving} className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {saving ? 'Đang lưu...' : 'Lưu'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
