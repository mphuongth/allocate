'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { CairnLoader } from './CairnLoader'

// The pending state as a component, not as a checklist (#235, #688).
//
// The cairn loader has been the app's loading vocabulary since #235, but only
// five of 27 dialog files ever put it on a confirm button. The rest answered a
// click with an opacity change, and several not even that — the icon and the
// label held perfectly still while the request was in flight, which reads as
// "nothing happened, press it again".
//
// Same lesson as DialogShell: a contract every caller has to remember is not a
// contract. A caller supplies the resting icon and label; the button owns the
// loader swap, the busy semantics and the guard against a second submit, and
// cannot opt out of them by forgetting a line.

type LoaderVariant = 'on-dark' | 'muted' | 'pos' | ''

export default function PendingButton({
  pending,
  pendingLabel,
  icon,
  // Filled primary/negative buttons are the common case, and the button keeps
  // its background while pending so the loader stays legible against it.
  loaderVariant = 'on-dark',
  loaderSize = 14,
  disabled,
  type = 'button',
  children,
  ...rest
}: {
  /** True while this button's action is in flight. */
  pending: boolean
  /** Label shown instead of `children` while pending. Omit to keep the resting label. */
  pendingLabel?: ReactNode
  /** The resting icon, replaced by the loader while pending. */
  icon?: ReactNode
  loaderVariant?: LoaderVariant
  loaderSize?: number
  children?: ReactNode
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  return (
    <button
      type={type}
      // A click already in flight cannot be sent twice, whatever the caller passed.
      disabled={disabled || pending}
      aria-busy={pending}
      {...rest}
    >
      {pending ? (
        // Hidden from the accessible name: the loader carries its own
        // role=status/aria-label, which would otherwise be read as part of the
        // button ("Loading Saving…"). aria-busy is what announces the state.
        <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center' }}>
          <CairnLoader size={loaderSize} variant={loaderVariant} />
        </span>
      ) : (
        icon
      )}
      {pending && pendingLabel !== undefined ? pendingLabel : children}
    </button>
  )
}
