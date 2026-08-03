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
  // The add-transaction sheet's open flag. The mobile bottom tabs' centre "+"
  // opens it, but the sheet itself is a dashboard component rendered by the
  // route group — this layout is shared chrome and may not import one (#600).
  addTransactionOpen: boolean
  openAddTransaction: () => void
  closeAddTransaction: () => void
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
  addTransactionOpen: false,
  openAddTransaction: () => {},
  closeAddTransaction: () => {},
})

export function NavigationProvider({ children, userName: initialUserName }: { children: React.ReactNode; userName: string }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [userName, setUserName] = useState(initialUserName)
  const [mobileTopBar, setMobileTopBarState] = useState<MobileTopBarOpts>({ title: '' })
  const [addTransactionOpen, setAddTransactionOpen] = useState(false)

  // Re-sync from server-provided value when the underlying prop changes
  // (e.g. after a router.refresh that brings fresh user metadata down).
  useEffect(() => {
    setUserName(initialUserName)
  }, [initialUserName])

  const setMobileTopBar = useCallback((opts: MobileTopBarOpts) => {
    setMobileTopBarState(opts)
  }, [])

  const openAddTransaction = useCallback(() => setAddTransactionOpen(true), [])
  const closeAddTransaction = useCallback(() => setAddTransactionOpen(false), [])

  return (
    <NavigationContext.Provider value={{
      sidebarOpen, setSidebarOpen,
      sidebarCollapsed, setSidebarCollapsed,
      userName, setUserName,
      mobileTopBar, setMobileTopBar,
      addTransactionOpen, openAddTransaction, closeAddTransaction,
    }}>
      {children}
    </NavigationContext.Provider>
  )
}

export function useNavigation() {
  return useContext(NavigationContext)
}
