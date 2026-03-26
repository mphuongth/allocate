'use client'

import { useState } from 'react'
import type { MonthlyPlan, OtherExpense } from '../PlanningClient'

interface Props {
  plan: MonthlyPlan
  otherExpenses: OtherExpense[]
  onRefresh: () => void
  onToast: (msg: string) => void
}

const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')
const inputCls = 'w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500'

export default function OtherExpensesSection({ plan, otherExpenses, onRefresh, onToast }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ description: '', amount_vnd: '' })
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<OtherExpense | null>(null)

  function openAdd() {
    setForm({ description: '', amount_vnd: '' })
    setFormError('')
    setShowForm(true)
  }

  async function handleSave() {
    setFormError('')
    if (!form.description.trim()) {
      setFormError('Mô tả là bắt buộc')
      return
    }
    const amountNum = Number(form.amount_vnd)
    if (!form.amount_vnd || isNaN(amountNum) || amountNum <= 0) {
      setFormError('Số tiền là bắt buộc và phải dương')
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/v1/monthly-plans/${plan.id}/other-expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: form.description.trim(), amount_vnd: amountNum }),
      })
      if (!res.ok) {
        const { error } = await res.json()
        setFormError(error ?? 'Đã xảy ra lỗi. Vui lòng thử lại sau.')
      } else {
        setShowForm(false)
        onToast('Đã thêm chi phí khác')
        onRefresh()
      }
    } catch {
      setFormError('Không thể lưu. Vui lòng kiểm tra kết nối và thử lại.')
    }
    setSaving(false)
  }

  async function handleDelete(item: OtherExpense) {
    const res = await fetch(`/api/v1/monthly-plans/${plan.id}/other-expenses/${item.id}`, { method: 'DELETE' })
    if (res.ok) {
      setConfirmDelete(null)
      onToast('Đã xóa chi phí khác')
      onRefresh()
    }
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Chi phí Khác</h2>
        <button onClick={openAdd} className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
          Thêm Chi phí
        </button>
      </div>

      {otherExpenses.length === 0 ? (
        <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm">Chi phí phát sinh không thường xuyên trong tháng này</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              {['Mô tả', 'Số tiền', 'Thao tác'].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {otherExpenses.map((item) => (
              <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{item.description}</td>
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{fmt(item.amount_vnd)}</td>
                <td className="px-4 py-3">
                  <button onClick={() => setConfirmDelete(item)} className="text-xs text-red-500 dark:text-red-400 hover:underline">Xóa</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Add Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm p-6 border border-gray-100 dark:border-gray-700">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Thêm Chi phí Khác</h3>
            {formError && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{formError}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mô tả *</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="VD: Mua laptop, Sửa xe..."
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Số tiền (VND) *</label>
                <input
                  type="number"
                  value={form.amount_vnd}
                  onChange={(e) => setForm({ ...form, amount_vnd: e.target.value })}
                  className={inputCls}
                />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Hủy</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {saving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {saving ? 'Đang lưu...' : 'Lưu'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm p-6 border border-gray-100 dark:border-gray-700">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">Xóa Chi phí</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Bạn có chắc muốn xóa khoản chi phí này?</p>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-5">{confirmDelete.description} — {fmt(confirmDelete.amount_vnd)}</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Hủy</button>
              <button onClick={() => handleDelete(confirmDelete)} className="flex-1 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700">Xác nhận</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
