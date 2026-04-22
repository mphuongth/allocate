'use client'

import React from 'react'

interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: string
  onChange: (raw: string) => void
}

function formatDisplay(raw: string): string {
  if (!raw) return ''
  const dotIndex = raw.indexOf('.')
  if (dotIndex === -1) {
    const n = Number(raw)
    return isNaN(n) ? raw : n.toLocaleString('en-US')
  }
  const intPart = raw.slice(0, dotIndex)
  const decPart = raw.slice(dotIndex)
  const n = Number(intPart)
  const formattedInt = intPart === '' ? '' : isNaN(n) ? intPart : n.toLocaleString('en-US')
  return formattedInt + decPart
}

export default function DecimalInput({ value, onChange, ...props }: Props) {
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const cleaned = e.target.value.replace(/,/g, '').replace(/[^0-9.]/g, '')
    const parts = cleaned.split('.')
    const normalized = parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : cleaned
    onChange(normalized)
  }

  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      value={formatDisplay(value)}
      onChange={handleChange}
    />
  )
}
