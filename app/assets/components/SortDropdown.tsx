'use client'

import { useState, useEffect, useRef } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import type { SortValue } from '@/features/dashboard/dashboardModel'

// The goal-list sort control. Purely presentational — it owns nothing but its
// own open/closed state and the outside-click that closes it. Split out of
// DashboardClient (#602), which had it inline above the page component.
export default function SortDropdown({ value, onChange, options }: {
  value: SortValue
  onChange: (v: SortValue) => void
  options: { value: SortValue; label: string }[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 13, padding: '5px 10px', cursor: 'pointer',
          background: 'var(--c-card)', border: '1px solid var(--c-line)',
          borderRadius: 8, color: 'var(--c-ink)', fontFamily: 'inherit', fontWeight: 500,
          whiteSpace: 'nowrap',
        }}
      >
        {current?.label}
        <ChevronDown size={12} style={{ color: 'var(--c-muted)', flexShrink: 0 }} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 50,
          background: 'var(--c-card)', border: '1px solid var(--c-line)',
          borderRadius: 10, boxShadow: 'var(--shadow-pop)',
          minWidth: 160, overflow: 'hidden',
        }}>
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false) }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', padding: '10px 14px', border: 'none', cursor: 'pointer',
                background: o.value === value ? 'var(--c-navy-tint)' : 'transparent',
                color: o.value === value ? 'var(--c-navy)' : 'var(--c-ink)',
                fontSize: 14, fontFamily: 'inherit', fontWeight: o.value === value ? 600 : 400,
                textAlign: 'left',
              }}
            >
              {o.label}
              {o.value === value && <Check size={13} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
