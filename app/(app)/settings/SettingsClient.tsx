'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import MobileSettingsView from './components/MobileSettingsView'
import DesktopSettingsView from './components/DesktopSettingsView'
import InvestmentTransactionsTab from './tabs/InvestmentTransactionsTab'
import FixedExpensesTab from './tabs/FixedExpensesTab'
import InsuranceMembersTab from './tabs/InsuranceMembersTab'

// Goals are managed from the dashboard goal detail now; the legacy goals tab
// was removed. The remaining data tabs are reachable only via ?tab=<id>.
const TAB_IDS = ['transactions', 'expenses', 'insurance'] as const

type TabId = typeof TAB_IDS[number]

const VALID_TABS = TAB_IDS as unknown as string[]

interface Props {
  initialTab?: string
  email: string
  initials: string
  displayName: string
}

export default function SettingsClient({ initialTab, email, initials, displayName }: Props) {
  const router = useRouter()
  const t = useTranslations('settings')
  const showDataTabs = VALID_TABS.includes(initialTab ?? '')
  const [activeTab, setActiveTab] = useState<TabId>(
    showDataTabs ? (initialTab as TabId) : 'transactions'
  )

  function handleTabChange(tab: TabId) {
    setActiveTab(tab)
    router.replace(`/settings?tab=${tab}`)
  }

  return (
    <>
      {/* Mobile redesign view */}
      <MobileSettingsView email={email} initials={initials} displayName={displayName} />

      {showDataTabs ? (
        /* Desktop tab-based view for data management tabs (transactions/expenses/insurance) */
        <div className="hidden md:block space-y-6">
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('description')}</p>
          </div>

          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-3 w-full items-center rounded-xl bg-[#ececf0] dark:bg-gray-800 p-[3px] gap-[3px]">
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

            <div className="mt-4">
              {activeTab === 'transactions' && <InvestmentTransactionsTab />}
              {activeTab === 'expenses' && <FixedExpensesTab />}
              {activeTab === 'insurance' && <InsuranceMembersTab />}
            </div>
          </div>
        </div>
      ) : (
        /* New desktop preferences/settings view */
        <DesktopSettingsView email={email} initials={initials} displayName={displayName} />
      )}
    </>
  )
}
