'use client'

import React from 'react'

interface Props {
  title: string
  subtitle?: string
  trailing?: React.ReactNode
  dense?: boolean
}

export default function MobileTopBar({ title, subtitle, trailing, dense }: Props) {
  return (
    <header
      className="md:hidden sticky top-0 z-30 flex items-center justify-between bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800"
      style={{ padding: dense ? '8px 16px' : '12px 16px' }}
    >
      <div>
        {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400 leading-none mb-0.5">{subtitle}</p>}
        <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100 leading-tight">{title}</h1>
      </div>
      {trailing && <div className="flex items-center">{trailing}</div>}
    </header>
  )
}
