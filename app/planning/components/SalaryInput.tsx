'use client'

import { useState, useRef } from 'react'
import type { MonthlyPlan } from '../PlanningClient'

const MONTHS = ['Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6','Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12']

interface Props {
  plan: MonthlyPlan | null
  month: number
  year: number
  onPlanCreated: (plan: MonthlyPlan) => void
  onPlanDeleted: () => void
}

export default function SalaryInput({ plan, month, year, onPlanCreated, onPlanDeleted }: Props) {
  const [value, setValue] = useState(plan ? String(plan.salary_vnd) : '')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState('')
  const prevPlanId = useRef(plan?.id)

  // Reset when plan changes (month navigation)
  if (plan?.id !== prevPlanId.current) {
    prevPlanId.current = plan?.id
    setValue(plan ? String(plan.salary_vnd) : '')
  }

  async function saveSalary() {
    const num = Number(value)
    if (!value || isNaN(num) || num <= 0) {
      setError('Lương phải lớn hơn 0')
      return
    }
    setError('')
    setSaving(true)

    try {
      if (plan) {
        const res = await fetch(`/api/v1/monthly-plans/${plan.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ salary_vnd: num }),
        })
        if (!res.ok) {
          const { error: e } = await res.json()
          setError(e ?? 'Đã xảy ra lỗi. Vui lòng thử lại sau.')
        }
      } else {
        const res = await fetch('/api/v1/monthly-plans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ month, year, salary_vnd: num }),
        })
        if (res.ok) {
          const newPlan = await res.json()
          onPlanCreated(newPlan)
        } else {
          const { error: e } = await res.json()
          setError(e ?? 'Đã xảy ra lỗi. Vui lòng thử lại sau.')
        }
      }
    } catch {
      setError('Không thể lưu. Vui lòng kiểm tra kết nối và thử lại.')
    }
    setSaving(false)
  }

  async function confirmDelete() {
    if (!plan) return
    setDeleting(true)
    setShowConfirm(false)
    try {
      const res = await fetch(`/api/v1/monthly-plans/${plan.id}`, { method: 'DELETE' })
      if (res.ok) {
        onPlanDeleted()
      } else {
        const { error: e } = await res.json()
        setError(e ?? 'Xóa thất bại. Vui lòng thử lại.')
      }
    } catch {
      setError('Không thể xóa. Vui lòng kiểm tra kết nối và thử lại.')
    }
    setDeleting(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') saveSalary()
  }

  return (
    <>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Lương Tháng (VND)</label>
        {error && <p className="text-red-600 dark:text-red-400 text-sm mb-2">{error}</p>}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm font-medium">₫</span>
            <input
              type="number"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={saveSalary}
              onKeyDown={handleKeyDown}
              disabled={saving}
              placeholder="Nhập lương tháng để bắt đầu lập kế hoạch"
              className="w-full pl-7 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
            />
          </div>
          {saving && (
            <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          )}
          {plan && (
            <button
              onClick={() => setShowConfirm(true)}
              disabled={deleting || saving}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {deleting ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                'Xóa'
              )}
            </button>
          )}
        </div>
      </div>

      {/* Confirmation modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowConfirm(false)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl p-6 w-full max-w-sm mx-4 border border-gray-100 dark:border-gray-700">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">Xóa bản ghi lương?</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
              Thao tác này sẽ xóa vĩnh viễn bản ghi lương của{' '}
              <span className="font-medium text-gray-700 dark:text-gray-300">{MONTHS[month - 1]} {year}</span>{' '}
              và tất cả các phân bổ liên quan. Hành động này không thể hoàn tác.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700"
              >
                Hủy
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700"
              >
                Xóa
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
