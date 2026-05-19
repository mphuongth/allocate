'use client'

import React from 'react'

interface MobileTopBarProps {
  title: string
  subtitle?: string
  trailing?: React.ReactNode
  dense?: boolean
}

export default function MobileTopBar({ title, subtitle, trailing, dense }: MobileTopBarProps) {
  return (
    <header
      data-testid="mobile-top-bar"
      className="md:hidden"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        background: 'var(--c-canvas)',
        padding: dense ? '8px 16px 6px' : '14px 16px 10px',
        borderBottom: '1px solid transparent',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 32 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {subtitle && (
            <div style={{
              fontSize: 11,
              color: 'var(--c-muted)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              fontWeight: 600,
            }}>
              {subtitle}
            </div>
          )}
          <h1 style={{
            margin: 0,
            fontSize: dense ? 17 : 22,
            fontWeight: 600,
            letterSpacing: '-0.015em',
            color: 'var(--c-ink)',
          }}>
            {title}
          </h1>
        </div>
        {trailing && <div style={{ flexShrink: 0 }}>{trailing}</div>}
      </div>
    </header>
  )
}
