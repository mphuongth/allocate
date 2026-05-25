'use client'

import MobileFundLibraryView from './components/MobileFundLibraryView'
import DesktopFundLibraryView from './components/DesktopFundLibraryView'

export default function FundLibraryClient() {
  return (
    <>
      <MobileFundLibraryView />
      <DesktopFundLibraryView />
    </>
  )
}
