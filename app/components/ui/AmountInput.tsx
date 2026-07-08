'use client'

import React from 'react'
import { formatIntVN, parseIntVN } from '@/lib/numberFormat'

interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: string
  onChange: (raw: string) => void
}

export default function AmountInput({ value, onChange, ...props }: Props) {
  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      value={formatIntVN(value)}
      onChange={(e) => onChange(parseIntVN(e.target.value))}
    />
  )
}
