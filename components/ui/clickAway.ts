import type { MouseEvent, PointerEvent } from 'react'

// Dismiss-on-click-away that can tell a click from the end of a drag.
//
// Every overlay in this app pairs a backdrop `onClick={onClose}` with a panel
// `onClick={(e) => e.stopPropagation()}`, and that pairing has a hole. A press
// and a release in DIFFERENT elements fire the click on their nearest common
// ancestor — so selecting the text in a field by dragging from inside the panel
// out past its edge fires the click on the backdrop itself. The panel is not on
// that event's path at all, so its stopPropagation never runs, and the dialog
// closed with whatever the user had typed.
//
// A click-away is a press AND a release on the backdrop. That is what this
// measures. The pointer events are read on the backdrop, where they arrive by
// bubbling from wherever inside it the gesture actually happened.
//
// The flag is module-level rather than per-instance because a pointer gesture is
// a property of the document, not of a component: exactly one is in flight at a
// time, and every overlay is asking the same question about the same gesture.
// That also keeps this a plain function, usable at the two or three overlays a
// single component may render without the rules of hooks getting in the way.
let pressStartedInside = false

/** The original backdrop handler; `undefined` for an overlay that doesn't dismiss. */
type Dismiss = ((e: MouseEvent) => void) | undefined

// Spread onto the backdrop element in place of its `onClick`.
export function clickAway(onDismiss: Dismiss) {
  return {
    onPointerDown: (e: PointerEvent) => {
      pressStartedInside = e.target !== e.currentTarget
    },
    // A release inside the panel means the click that follows is the panel's own
    // and will be stopped there — so clear the flag rather than carry it into a
    // later, genuine backdrop click.
    onPointerUp: (e: PointerEvent) => {
      if (e.target !== e.currentTarget) pressStartedInside = false
    },
    onClick: (e: MouseEvent) => {
      const startedInside = pressStartedInside
      // One gesture only: a drag out suppresses its own click and nothing after.
      pressStartedInside = false
      if (!startedInside) onDismiss?.(e)
    },
  }
}
