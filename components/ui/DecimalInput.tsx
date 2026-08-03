'use client'

import React from 'react'
import { formatDecimalVN, parseDecimalVN } from '@/lib/numberFormat'

interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: string
  onChange: (raw: string) => void
}

export default function DecimalInput({ value, onChange, ...props }: Props) {
  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      value={formatDecimalVN(value)}
      onChange={(e) => onChange(parseDecimalVN(e.target.value))}
    />
  )
}
