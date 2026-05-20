'use client'

import { createContext, useContext, useState, useCallback } from 'react'

interface MobileTopBarOpts {
  title: string
  subtitle?: string
  trailing?: React.ReactNode
  dense?: boolean
}

interface NavigationContextValue {
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
  userName: string
  mobileTopBar: MobileTopBarOpts
  setMobileTopBar: (opts: MobileTopBarOpts) => void
  hideDesktopHeader: boolean
  setHideDesktopHeader: (v: boolean) => void
}

const NavigationContext = createContext<NavigationContextValue>({
  sidebarOpen: false,
  setSidebarOpen: () => {},
  sidebarCollapsed: false,
  setSidebarCollapsed: () => {},
  userName: '',
  mobileTopBar: { title: '' },
  setMobileTopBar: () => {},
  hideDesktopHeader: false,
  setHideDesktopHeader: () => {},
})

export function NavigationProvider({ children, userName }: { children: React.ReactNode; userName: string }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileTopBar, setMobileTopBarState] = useState<MobileTopBarOpts>({ title: '' })
  const [hideDesktopHeader, setHideDesktopHeader] = useState(false)

  const setMobileTopBar = useCallback((opts: MobileTopBarOpts) => {
    setMobileTopBarState(opts)
  }, [])

  return (
    <NavigationContext.Provider value={{
      sidebarOpen, setSidebarOpen,
      sidebarCollapsed, setSidebarCollapsed,
      userName,
      mobileTopBar, setMobileTopBar,
      hideDesktopHeader, setHideDesktopHeader,
    }}>
      {children}
    </NavigationContext.Provider>
  )
}

export function useNavigation() {
  return useContext(NavigationContext)
}
