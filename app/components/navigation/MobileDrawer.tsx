'use client'

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import Sidebar from './Sidebar'

interface MobileDrawerProps {
  open: boolean
  onClose: () => void
  email: string
  initials: string
}

export default function MobileDrawer({ open, onClose, email, initials }: MobileDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null)

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (open) document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  // Focus trap
  useEffect(() => {
    if (open && drawerRef.current) {
      const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
        'a, button, [tabindex]:not([tabindex="-1"])'
      )
      if (focusable.length) focusable[0].focus()

      function handleTab(e: KeyboardEvent) {
        if (e.key !== 'Tab') return
        const els = Array.from(focusable)
        const first = els[0]
        const last = els[els.length - 1]
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus() }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus() }
        }
      }
      document.addEventListener('keydown', handleTab)
      return () => document.removeEventListener('keydown', handleTab)
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Drawer */}
      <div
        ref={drawerRef}
        className="absolute left-0 top-0 h-full w-[280px] max-w-[90vw] bg-white shadow-xl flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
      >
        <div className="flex items-center justify-between px-4 h-14 border-b border-gray-100">
          <span className="text-brand font-bold text-xl tracking-tight">Allocate</span>
          <button
            onClick={onClose}
            aria-label="Close navigation menu"
            className="p-1 rounded hover:bg-gray-100 transition-colors"
          >
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <Sidebar email={email} initials={initials} onNavClick={onClose} />
        </div>
      </div>
    </div>
  )
}
