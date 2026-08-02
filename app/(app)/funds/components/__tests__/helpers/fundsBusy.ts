import { useState } from 'react'
import type { FundsBusy } from '../../useFundsData'

/**
 * The in-flight fund set the two views normally get from FundLibraryClient,
 * for specs that render a single view on its own. Real state, not a stub, so a
 * spec can assert that a busy fund's controls are disabled (#590).
 */
export function useFundsBusy(): FundsBusy {
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())
  return { togglingIds, setTogglingIds }
}
