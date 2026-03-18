'use client'

import { useState, useRef } from 'react'
import type { MonthlyPlan } from '../PlanningClient'

interface Props {
  plan: MonthlyPlan | null
  month: number
  year: number
  onPlanCreated: (plan: MonthlyPlan) => void
}

export default function SalaryInput({ plan, month, year, onPlanCreated }: Props) {
  const [value, setValue] = useState(plan ? String(plan.salary_vnd) : '')
  const [saving, setSaving] = useState(false)
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
      setError('Salary must be positive')
      return
    }
    setError('')
    setSaving(true)

    try {
      if (plan) {
        // Update existing plan
        const res = await fetch(`/api/v1/monthly-plans/${plan.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ salary_vnd: num }),
        })
        if (!res.ok) {
          const { error: e } = await res.json()
          setError(e ?? 'Something went wrong. Please try again later.')
        }
      } else {
        // Create new plan on blur
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
          setError(e ?? 'Something went wrong. Please try again later.')
        }
      }
    } catch {
      setError('Unable to save. Please check your connection and try again.')
    }
    setSaving(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') saveSalary()
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <label className="block text-sm font-semibold text-gray-700 mb-2">Monthly Salary (VND)</label>
      {error && <p className="text-red-600 text-sm mb-2">{error}</p>}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">₫</span>
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={saveSalary}
            onKeyDown={handleKeyDown}
            disabled={saving}
            placeholder="Enter your monthly salary to begin planning"
            className="w-full pl-7 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
          />
        </div>
        {saving && (
          <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        )}
      </div>
    </div>
  )
}
