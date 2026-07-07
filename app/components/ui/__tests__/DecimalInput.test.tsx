import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import DecimalInput from '../DecimalInput'

describe('DecimalInput (VN)', () => {
  it('displays the canonical decimal in VN form', () => {
    const { getByRole } = render(<DecimalInput value="25219.5" onChange={() => {}} />)
    expect((getByRole('textbox') as HTMLInputElement).value).toBe('25.219,5')
  })

  it('groups a whole number with dots', () => {
    const { getByRole } = render(<DecimalInput value="20000" onChange={() => {}} />)
    expect((getByRole('textbox') as HTMLInputElement).value).toBe('20.000')
  })

  it('accepts a comma from the mobile keypad as the decimal separator', () => {
    const onChange = vi.fn()
    const { getByRole } = render(<DecimalInput value="20000" onChange={onChange} />)
    fireEvent.change(getByRole('textbox'), { target: { value: '20.000,5' } })
    expect(onChange).toHaveBeenCalledWith('20000.5')
  })

  it('uses a decimal input mode', () => {
    const { getByRole } = render(<DecimalInput value="" onChange={() => {}} />)
    expect(getByRole('textbox').getAttribute('inputmode')).toBe('decimal')
  })
})
