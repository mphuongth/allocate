'use client'

import { useCallback, useState } from 'react'
import { useManagedTimeout } from '@/components/ui/useManagedTimeout'
import { SAVE_FLASH_MS } from './settingsOptions'

// The profile editor's draft state and its save sequence (#603).
//
// Desktop kept this inline in the modal, mobile in a ProfileSheet — the same
// six lines twice, each with a local `SAVE_FLASH_MS = 1400` and a comment
// promising to keep it in step with the other. The chrome around it genuinely
// differs (a centred modal vs a bottom sheet), the sequence does not.

export interface ProfileEditor {
  /** The draft name, which can be ahead of what the account holds. */
  name: string
  setName: (name: string) => void
  /** True while the success flash is showing. */
  saved: boolean
  /** Persist the draft; on success flash, then call `onDone`. */
  save: () => Promise<void>
  /** Re-open on the current display name, discarding an abandoned edit. */
  reset: () => void
}

export function useProfileEditor(
  displayName: string,
  saveProfile: (name: string) => Promise<boolean>,
  onDone: () => void,
): ProfileEditor {
  const [name, setName] = useState(displayName)
  const [saved, setSaved] = useState(false)
  const scheduleFlashReset = useManagedTimeout()

  const reset = useCallback(() => {
    setName(displayName)
    setSaved(false)
  }, [displayName])

  const save = useCallback(async () => {
    // Only flash "Saved" and close once the write succeeded — a failed update
    // surfaces its own toast from saveProfile and keeps the form open over the
    // name the user typed.
    const ok = await saveProfile(name)
    if (!ok) return
    setSaved(true)
    scheduleFlashReset(() => { setSaved(false); onDone() }, SAVE_FLASH_MS)
  }, [saveProfile, name, onDone, scheduleFlashReset])

  return { name, setName, saved, save, reset }
}
