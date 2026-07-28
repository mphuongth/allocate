'use client'

import { useEffect, useState } from 'react'

// How long a sheet's exit animation runs. Every dialog in the app uses the same
// 220ms, so it's the default rather than something each caller repeats.
const EXIT_MS = 220

// Should a dialog be in the DOM right now?
//
// Sheets need to outlive `open` briefly or their exit animation never plays —
// React would remove the node on the same commit that flips the flag. Ten
// components hand-rolled that as:
//
//   useEffect(() => {
//     if (open) setMounted(true)
//     else { const t = setTimeout(() => setMounted(false), 220); return () => clearTimeout(t) }
//   }, [open])
//
// which sets state synchronously inside an effect: an extra render pass on every
// open, and the pattern react-hooks/set-state-in-effect flags (#537).
//
// The value is derivable — mounted = open || still-animating-out — so only the
// "still animating" half needs to be state. The open→closing transition happens
// during render, which is React's documented way to adjust state when a prop
// changes, and the effect is left holding nothing but the timer. Being a
// timeout, that setState is asynchronous and isn't the flagged shape.
export function useDialogMount(open: boolean, exitMs: number = EXIT_MS): boolean {
  const [closing, setClosing] = useState(false)
  // The previous `open` is state, not a ref: react-hooks/refs forbids reading or
  // writing a ref during render, and this comparison has to happen there. It's
  // also what React's own "adjusting state when a prop changes" guidance uses.
  const [wasOpen, setWasOpen] = useState(open)

  if (wasOpen !== open) {
    setWasOpen(open)
    // Closing: hold the node until the animation finishes. Opening: drop any
    // pending exit so a dialog reopened mid-animation doesn't get unmounted a
    // moment later by the timer from its own close.
    setClosing(!open)
  }

  useEffect(() => {
    if (!closing) return
    const t = setTimeout(() => setClosing(false), exitMs)
    return () => clearTimeout(t)
  }, [closing, exitMs])

  return open || closing
}

// Run `reset` in the render where `open` flips false → true, and again while
// open whenever `syncKey` changes.
//
// Dialogs stay mounted through their exit animation, so their form state
// survives a close and has to be cleared on the way back in. Doing that in an
// effect means the stale values render for a frame first — the user sees the
// previous record's data flash — and it's the set-state-in-effect shape (#537).
//
// `syncKey` is not optional decoration. A dialog seeded from a prop has to
// re-seed if that prop changes underneath it: planning renders from a 2-minute
// localStorage cache while it refetches in the background, so the salary sheet
// can be opened against cached data and have the fresh value land a moment
// later. Without re-syncing, saving writes the stale cached number back over the
// server's. Pass the source object (the old effects' `[open, plan]` /
// `[open, goal]` dependency); omit it only when nothing but `open` matters.
//
// Adjusting during render is React's documented answer for "reset state when a
// prop changes": the re-render happens before the browser paints, so nothing
// stale is ever shown. `reset` is called during render and must therefore only
// set state — no fetching, no subscriptions.
// Run `reset` in the render where `key` changes — the same adjustment as
// useResetOnOpen, for state that tracks a prop on an always-visible surface
// (the desktop goal panel has no `open`; switching goals is the whole event).
export function useResetOnChange(key: unknown, reset: () => void): void {
  const [prev, setPrev] = useState(key)
  if (!Object.is(prev, key)) {
    setPrev(key)
    reset()
  }
}

export function useResetOnOpen(open: boolean, reset: () => void, syncKey?: unknown): void {
  const [prev, setPrev] = useState({ open, syncKey })
  if (prev.open !== open || !Object.is(prev.syncKey, syncKey)) {
    setPrev({ open, syncKey })
    // Only while open: a key that churns behind a closed dialog is nothing to
    // react to, and resetting then would fight whatever opens it next.
    if (open) reset()
  }
}
