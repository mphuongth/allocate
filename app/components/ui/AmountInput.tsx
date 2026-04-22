'use client'

import React from 'react'

interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: string
  onChange: (raw: string) => void
}

export default function AmountInput({ value, onChange, ...props }: Props) {
  const display = value ? Number(value).toLocaleString('vi-VN') : ''
  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      value={display}
      onChange={(e) => onChange(e.target.value.replace(/\./g, '').replace(/[^0-9]/g, ''))}
    />
  )
}
