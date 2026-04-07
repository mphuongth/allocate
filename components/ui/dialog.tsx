'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const DialogContext = React.createContext<{ close: () => void }>({ close: () => {} })

/* ─── Root ─────────────────────────────────────────────────────────────────── */

function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children?: React.ReactNode
}) {
  const close = React.useCallback(() => onOpenChange?.(false), [onOpenChange])

  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, close])

  if (!open) return null
  return <DialogContext.Provider value={{ close }}>{children}</DialogContext.Provider>
}

/* ─── Portal ────────────────────────────────────────────────────────────────── */

function DialogPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  if (!mounted) return null
  return createPortal(children, document.body)
}

/* ─── Content ───────────────────────────────────────────────────────────────── */

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<'div'> & { showCloseButton?: boolean }) {
  const { close } = React.useContext(DialogContext)

  return (
    <DialogPortal>
      {/* Backdrop — click outside to close */}
      <div
        className="fixed inset-0 z-50 bg-black/50"
        onClick={close}
        aria-hidden="true"
      />
      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        data-slot="dialog-content"
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white dark:bg-gray-900 p-6 shadow-xl sm:max-w-sm',
          className
        )}
        onClick={(e) => e.stopPropagation()}
        {...props}
      >
        {children}
        {showCloseButton && (
          <button
            onClick={close}
            className="absolute right-4 top-4 rounded-md p-1 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </DialogPortal>
  )
}

/* ─── Header / Footer / Title / Description ─────────────────────────────────── */

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('flex flex-col gap-1.5 mb-4', className)} {...props} />
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-footer" className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />
}

function DialogTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return <h2 data-slot="dialog-title" className={cn('text-lg font-semibold text-gray-900 dark:text-gray-100 leading-none', className)} {...props} />
}

function DialogDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p data-slot="dialog-description" className={cn('text-sm text-gray-500 dark:text-gray-400', className)} {...props} />
}

/* ─── Close button ───────────────────────────────────────────────────────────── */

function DialogClose({ className, children, ...props }: React.ComponentProps<'button'>) {
  const { close } = React.useContext(DialogContext)
  return (
    <button onClick={close} className={className} {...props}>
      {children}
    </button>
  )
}

/* ─── Unused stubs (kept for import compatibility) ───────────────────────────── */

function DialogTrigger({ children, ...props }: React.ComponentProps<'button'>) {
  return <button {...props}>{children}</button>
}

function DialogOverlay({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('fixed inset-0 z-50 bg-black/50', className)} {...props} />
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
