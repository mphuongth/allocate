import { useEffect, useMemo, useRef, type RefObject } from 'react'

// Shared dialog accessibility for every modal/sheet wrapper in the app — the
// Plan page's DModal/Sheet, the settings views, the fund library, the dashboard
// sheets. It was owned by Planning and imported from four other features, which
// is what moved it here (#600). While active it:
//   • closes on Escape,
//   • moves focus into the dialog on open (unless something inside is already
//     focused, e.g. an autoFocus field) and restores it to the previously
//     focused element on close,
//   • traps Tab/Shift+Tab within the dialog.
// Effects key only on [active, ref] — onClose is read through a ref so an inline
// `onClose={() => …}` (new identity each render) doesn't re-run focus handling
// and steal focus mid-interaction.

// Close an open popover (a kebab menu) when anything scrolls. The menus are
// position:fixed (computed once from the trigger's rect), so without this they
// detach and float when the page or a scroll container moves. Capture phase so
// scrolls from inner scroll containers count too.
export function useCloseOnScroll(active: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })
  useEffect(() => {
    if (!active) return
    const close = () => onCloseRef.current()
    window.addEventListener('scroll', close, true)
    return () => window.removeEventListener('scroll', close, true)
  }, [active])
}

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
  'input:not([disabled])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',')

// Which dialogs are open, innermost last. Every dialog listens on document, so
// without this an Escape in a dialog opened FROM a dialog — the successor flow —
// ran both handlers and collapsed the whole pile: the user asked to leave one
// sheet and lost the one underneath too. stopPropagation cannot help, because
// the listeners share a target. Nor can the Tab trap be left ungated: the dialog
// underneath would answer as well, pulling focus out of the one on top (#688).
const openDialogs: object[] = []

export function useDialogA11y(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onClose: () => void,
) {
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  // Identity for this dialog's place in the stack — stable across renders, and
  // useMemo rather than a ref because the value is read while rendering the
  // effect's dependencies, which reading a ref there is not allowed to do.
  const token = useMemo(() => ({}), [])
  useEffect(() => {
    if (!active) return
    openDialogs.push(token)
    return () => {
      const at = openDialogs.indexOf(token)
      if (at !== -1) openDialogs.splice(at, 1)
    }
  }, [active, token])

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
      // Only the dialog on top answers. A dialog that is open but covered is not
      // the one the user is interacting with.
      if (openDialogs[openDialogs.length - 1] !== token) return
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
  }, [active, ref, token])
}
