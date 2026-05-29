import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import InsuranceEmpty from '../InsuranceEmpty'

const KEY = 'cairn.insuranceCoachDismissed'

beforeEach(() => {
  localStorage.clear()
})

describe('InsuranceEmpty (issue: empty insurance state)', () => {
  it('shows the risk-framed coach with the unprotected-goals count', () => {
    render(<InsuranceEmpty goalCount={3} locale="en" onAdd={vi.fn()} />)
    expect(screen.getByText('3 goals are unprotected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add member/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /later/i })).toBeInTheDocument()
  })

  it('calls onAdd when the coach "Add member" button is clicked', async () => {
    const onAdd = vi.fn()
    render(<InsuranceEmpty goalCount={1} locale="en" onAdd={onAdd} />)
    await userEvent.click(screen.getByRole('button', { name: /add member/i }))
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('collapses to a quiet placeholder after "Later" and persists the dismissal', async () => {
    render(<InsuranceEmpty goalCount={2} locale="en" onAdd={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /later/i }))
    expect(screen.getByText('No members yet')).toBeInTheDocument()
    expect(screen.queryByText('2 goals are unprotected')).not.toBeInTheDocument()
    expect(localStorage.getItem(KEY)).toBe('1')
  })

  it('renders the quiet placeholder directly when previously dismissed', () => {
    localStorage.setItem(KEY, '1')
    render(<InsuranceEmpty goalCount={2} locale="en" onAdd={vi.fn()} />)
    expect(screen.getByText('No members yet')).toBeInTheDocument()
    expect(screen.queryByText(/unprotected/)).not.toBeInTheDocument()
  })

  it('keeps an Add path in the quiet placeholder', async () => {
    localStorage.setItem(KEY, '1')
    const onAdd = vi.fn()
    render(<InsuranceEmpty goalCount={0} locale="en" onAdd={onAdd} />)
    await userEvent.click(screen.getByRole('button', { name: /add/i }))
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('renders Vietnamese copy when locale is vi', () => {
    render(<InsuranceEmpty goalCount={2} locale="vi" onAdd={vi.fn()} />)
    expect(screen.getByText('2 mục tiêu chưa được bảo vệ')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /thêm thành viên/i })).toBeInTheDocument()
  })
})
