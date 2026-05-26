'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'

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
  setUserName: (name: string) => void
  mobileTopBar: MobileTopBarOpts
  setMobileTopBar: (opts: MobileTopBarOpts) => void
}

const NavigationContext = createContext<NavigationContextValue>({
  sidebarOpen: false,
  setSidebarOpen: () => {},
  sidebarCollapsed: false,
  setSidebarCollapsed: () => {},
  userName: '',
  setUserName: () => {},
  mobileTopBar: { title: '' },
  setMobileTopBar: () => {},
})

export function NavigationProvider({ children, userName: initialUserName }: { children: React.ReactNode; userName: string }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [userName, setUserName] = useState(initialUserName)
  const [mobileTopBar, setMobileTopBarState] = useState<MobileTopBarOpts>({ title: '' })

  // Re-sync from server-provided value when the underlying prop changes
  // (e.g. after a router.refresh that brings fresh user metadata down).
  useEffect(() => {
    setUserName(initialUserName)
  }, [initialUserName])

  const setMobileTopBar = useCallback((opts: MobileTopBarOpts) => {
    setMobileTopBarState(opts)
  }, [])

  return (
    <NavigationContext.Provider value={{
      sidebarOpen, setSidebarOpen,
      sidebarCollapsed, setSidebarCollapsed,
      userName, setUserName,
      mobileTopBar, setMobileTopBar,
    }}>
      {children}
    </NavigationContext.Provider>
  )
}

export function useNavigation() {
  return useContext(NavigationContext)
}
