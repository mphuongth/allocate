'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import SavingsGoalsTab from './tabs/SavingsGoalsTab'
import InvestmentTransactionsTab from './tabs/InvestmentTransactionsTab'
import FixedExpensesTab from './tabs/FixedExpensesTab'
import InsuranceMembersTab from './tabs/InsuranceMembersTab'

const TAB_IDS = ['goals', 'transactions', 'expenses', 'insurance'] as const

type TabId = typeof TAB_IDS[number]

const VALID_TABS = TAB_IDS as unknown as string[]

interface Props {
  initialTab?: string
  initialGoalId?: string
}

export default function SettingsClient({ initialTab, initialGoalId }: Props) {
  const router = useRouter()
  const t = useTranslations('settings')
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
    <div className="space-y-6">
      <div>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('description')}</p>
      </div>

      {/* Tabs */}
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 sm:grid-cols-4 w-full items-center rounded-xl bg-[#ececf0] dark:bg-gray-800 p-[3px] gap-[3px]">
          {TAB_IDS.map((tabId) => (
            <button
              key={tabId}
              onClick={() => handleTabChange(tabId)}
              className={`inline-flex items-center justify-center rounded-[10px] border px-3 py-2 text-xs sm:text-sm font-medium text-center leading-tight transition-[color,box-shadow] ${
                activeTab === tabId
                  ? 'border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'border-transparent text-gray-900 dark:text-gray-400'
              }`}
            >
              {t(`tabs.${tabId}`)}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="mt-4">
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
    </div>
  )
}
