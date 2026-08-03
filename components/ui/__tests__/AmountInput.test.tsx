import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import AmountInput from '../AmountInput'

describe('AmountInput (VN)', () => {
  it('displays the canonical value grouped with dots', () => {
    const { getByRole } = render(<AmountInput value="2000000" onChange={() => {}} />)
    expect((getByRole('textbox') as HTMLInputElement).value).toBe('2.000.000')
  })

  it('shows an empty field for an empty value', () => {
    const { getByRole } = render(<AmountInput value="" onChange={() => {}} />)
    expect((getByRole('textbox') as HTMLInputElement).value).toBe('')
  })

  it('parses the typed VN string back to canonical digits', () => {
    const onChange = vi.fn()
    const { getByRole } = render(<AmountInput value="" onChange={onChange} />)
    fireEvent.change(getByRole('textbox'), { target: { value: '5.000.000' } })
    expect(onChange).toHaveBeenCalledWith('5000000')
  })

  it('uses a numeric input mode', () => {
    const { getByRole } = render(<AmountInput value="" onChange={() => {}} />)
    expect(getByRole('textbox').getAttribute('inputmode')).toBe('numeric')
  })
})
