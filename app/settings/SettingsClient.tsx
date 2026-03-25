'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import SavingsGoalsTab from './tabs/SavingsGoalsTab'
import InvestmentTransactionsTab from './tabs/InvestmentTransactionsTab'
import FixedExpensesTab from './tabs/FixedExpensesTab'
import InsuranceMembersTab from './tabs/InsuranceMembersTab'

const TABS = [
  { id: 'goals', label: 'Mục tiêu Tiết kiệm' },
  { id: 'transactions', label: 'Giao dịch Đầu tư' },
  { id: 'expenses', label: 'Chi phí Cố định' },
  { id: 'insurance', label: 'Thành viên Bảo hiểm' },
] as const

type TabId = typeof TABS[number]['id']

const VALID_TABS = TABS.map((t) => t.id) as string[]

interface Props {
  initialTab?: string
  initialGoalId?: string
}

export default function SettingsClient({ initialTab, initialGoalId }: Props) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabId>(
    VALID_TABS.includes(initialTab ?? '') ? (initialTab as TabId) : 'goals'
  )

  function handleTabChange(tab: TabId) {
    setActiveTab(tab)
    router.replace(`/settings?tab=${tab}`)
  }

  const handleGoalChange = useCallback((goalId: string | null) => {
    if (goalId) {
      router.replace(`/settings?tab=goals&goal=${goalId}`)
    } else {
      router.replace('/settings?tab=goals')
    }
  }, [router])

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Cài đặt</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Quản lý mục tiêu tiết kiệm, đầu tư, chi phí và bảo hiểm.</p>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200 dark:border-gray-700 mb-6">
          <nav className="-mb-px flex gap-1 overflow-x-auto">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`whitespace-nowrap py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-500'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab content */}
        {activeTab === 'goals' && (
          <SavingsGoalsTab
            initialGoalId={initialGoalId}
            onGoalChange={handleGoalChange}
          />
        )}
        {activeTab === 'transactions' && <InvestmentTransactionsTab />}
        {activeTab === 'expenses' && <FixedExpensesTab />}
        {activeTab === 'insurance' && <InsuranceMembersTab />}
      </div>
    </div>
  )
}
