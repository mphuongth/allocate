'use client'

import React, { useState } from 'react'

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

export default function DecimalInput({ value, onChange, onBlur, ...props }: Props) {
  const [focused, setFocused] = useState(false)

  // While focused: show raw value so cursor stays stable; on blur: show formatted
  const display = focused ? value : formatDisplay(value)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const cleaned = e.target.value.replace(/,/g, '').replace(/[^0-9.]/g, '')
    // prevent multiple dots
    const parts = cleaned.split('.')
    const normalized = parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : cleaned
    onChange(normalized)
  }

  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    setFocused(false)
    if (onBlur) onBlur(e)
  }

  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      value={display}
      onChange={handleChange}
      onFocus={() => setFocused(true)}
      onBlur={handleBlur}
    />
  )
}
