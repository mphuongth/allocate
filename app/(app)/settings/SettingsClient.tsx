'use client'

import { useTranslations } from 'next-intl'
import MobileSettingsView from './components/MobileSettingsView'
import DesktopSettingsView from './components/DesktopSettingsView'
import InvestmentTransactionsTab from './tabs/InvestmentTransactionsTab'

// Goals, insurance and fixed expenses are managed from the dashboard / plan
// page now; their legacy Settings tabs were removed. The only remaining data
// tab — investment transactions — is reachable via ?tab=transactions.
const VALID_TABS = ['transactions']

interface Props {
  initialTab?: string
  email: string
  initials: string
  displayName: string
}

export default function SettingsClient({ initialTab, email, initials, displayName }: Props) {
  const t = useTranslations('settings')
  const showDataTab = VALID_TABS.includes(initialTab ?? '')

  return (
    <>
      {/* Mobile redesign view */}
      <MobileSettingsView email={email} initials={initials} displayName={displayName} />

      {showDataTab ? (
        /* Desktop data-management view (investment transactions) */
        <div className="hidden md:block space-y-6">
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('description')}</p>
          </div>
          <div className="mt-4">
            <InvestmentTransactionsTab />
          </div>
        </div>
      ) : (
        /* New desktop preferences/settings view */
        <DesktopSettingsView email={email} initials={initials} displayName={displayName} />
      )}
    </>
  )
}
