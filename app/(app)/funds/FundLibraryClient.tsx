'use client'

import { useState } from 'react'
import MobileFundLibraryView from './components/MobileFundLibraryView'
import DesktopFundLibraryView from './components/DesktopFundLibraryView'
import { useFundsData } from './components/useFundsData'

export default function FundLibraryClient() {
  // Own the data layer once and share it with both always-mounted views, so the
  // page fetches funds + goals a single time and a mutation in either view
  // updates the one shared copy (#10).
  const data = useFundsData()

  // In-flight funds belong here for the same reason. A request started in one
  // view is still out when a resize across the breakpoint hands the user the
  // other one; with a busy set per view, that view would let a second write
  // stack on the first and each rollback would then aim at the other's
  // optimistic value instead of at what the server holds (#590).
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())
  const busy = { togglingIds, setTogglingIds }

  return (
    <>
      <MobileFundLibraryView {...data} {...busy} />
      <DesktopFundLibraryView {...data} {...busy} />
    </>
  )
}
