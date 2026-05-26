'use client'

import MobileSettingsView from './components/MobileSettingsView'
import DesktopSettingsView from './components/DesktopSettingsView'

interface Props {
  initialTab?: string
  initialGoalId?: string
  email: string
  initials: string
  displayName: string
}

export default function SettingsClient({ email, initials, displayName }: Props) {
  return (
    <>
      <MobileSettingsView email={email} initials={initials} displayName={displayName} />
      <DesktopSettingsView email={email} initials={initials} displayName={displayName} />
    </>
  )
}
