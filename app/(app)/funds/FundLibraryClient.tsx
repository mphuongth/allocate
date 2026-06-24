'use client'

import MobileFundLibraryView from './components/MobileFundLibraryView'
import DesktopFundLibraryView from './components/DesktopFundLibraryView'
import { useFundsData } from './components/useFundsData'

export default function FundLibraryClient() {
  // Own the data layer once and share it with both always-mounted views, so the
  // page fetches funds + goals a single time and a mutation in either view
  // updates the one shared copy (#10).
  const data = useFundsData()

  return (
    <>
      <MobileFundLibraryView {...data} />
      <DesktopFundLibraryView {...data} />
    </>
  )
}
