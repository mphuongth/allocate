'use client'

import MobileSettingsView from './components/MobileSettingsView'
import DesktopSettingsView from './components/DesktopSettingsView'

// Settings is now a pure preferences surface. Goals, insurance, fixed expenses
// and investment transactions are all managed from the dashboard / plan pages;
// their legacy Settings tabs have been removed (transactions → dashboard
// "Recent activity → View all").
interface Props {
  email: string
  initials: string
  displayName: string
}

export default function SettingsClient({ email, initials, displayName }: Props) {
  return (
    <>
      {/* Mobile redesign view */}
      <MobileSettingsView email={email} initials={initials} displayName={displayName} />
      {/* Desktop preferences view */}
      <DesktopSettingsView email={email} initials={initials} displayName={displayName} />
    </>
  )
}
