import { useEffect, useRef, type RefObject } from 'react'

// Shared dialog accessibility for the Plan page's modal/sheet wrappers (DModal,
// Sheet). While active it:
//   • closes on Escape,
//   • moves focus into the dialog on open (unless something inside is already
//     focused, e.g. an autoFocus field) and restores it to the previously
//     focused element on close,
//   • traps Tab/Shift+Tab within the dialog.
// Effects key only on [active, ref] — onClose is read through a ref so an inline
// `onClose={() => …}` (new identity each render) doesn't re-run focus handling
// and steal focus mid-interaction.

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
  'input:not([disabled])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',')

export function useDialogA11y(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onClose: () => void,
) {
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  // Focus in on open; restore on close.
  useEffect(() => {
    if (!active) return
    const node = ref.current
    const prevFocused = document.activeElement as HTMLElement | null
    if (node && !node.contains(document.activeElement)) {
      const els = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE))
      ;(els[0] ?? node).focus?.()
    }
    return () => { prevFocused?.focus?.() }
  }, [active, ref])

  // Escape to close + Tab trap.
  useEffect(() => {
    if (!active) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); return }
      if (e.key !== 'Tab') return
      const node = ref.current
      if (!node) return
      const els = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (els.length === 0) { e.preventDefault(); return }
      const first = els[0]
      const last = els[els.length - 1]
      const activeEl = document.activeElement
      if (e.shiftKey) {
        if (activeEl === first || !node.contains(activeEl)) { e.preventDefault(); last.focus() }
      } else if (activeEl === last || !node.contains(activeEl)) {
        e.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [active, ref])
}
