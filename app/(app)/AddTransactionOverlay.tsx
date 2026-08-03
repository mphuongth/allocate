'use client'

import { useNavigation } from '@/components/navigation/NavigationContext'
import AddTransactionSheet from '@/app/assets/components/AddTransactionSheet'

// The add-transaction sheet the mobile bottom tabs' centre "+" opens.
//
// It lives here rather than inside AuthenticatedLayout because the layout is
// shared chrome under `components/` and may not import a screen's component
// (#600). The route group owns the screens, so it owns this; the layout takes
// it as an opaque `overlays` node and the open flag travels through
// NavigationContext.
export default function AddTransactionOverlay() {
  const { addTransactionOpen, closeAddTransaction } = useNavigation()
  return <AddTransactionSheet open={addTransactionOpen} onClose={closeAddTransaction} />
}
