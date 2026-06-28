import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import UnallocatedSection from '../UnallocatedSection'

// Resolve real English copy from the catalog so the assertion checks rendered text.
vi.mock('next-intl', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const en = require('../../../../messages/en.json')
  const resolve = (ns: string | undefined, key: string) => {
    const dict = ns ? en[ns] : en
    return key.split('.').reduce((o: Record<string, unknown> | undefined, k: string) =>
      (o == null ? undefined : o[k] as Record<string, unknown>), dict) ?? key
  }
  return {
    useTranslations: (ns?: string) => (key: string) => resolve(ns, key),
    useLocale: () => 'en',
  }
})

const baseProps = {
  unallocatedAmount: 9_000_000,
  funds: [],
  nonFunds: [],
  onFundClick: vi.fn(),
  onAssignToGoal: vi.fn(),
  onSellFund: vi.fn(),
  onAssignNonFundToGoal: vi.fn(),
  onSellNonFund: vi.fn(),
}

describe('UnallocatedSection — explains what "Unallocated" means', () => {
  it('shows a one-line hint when the section is expanded (mobile)', () => {
    render(<UnallocatedSection {...baseProps} />)
    expect(screen.getByText(/not yet linked to a goal/i)).toBeInTheDocument()
  })

  it('shows the hint in the desktop card too', () => {
    render(<UnallocatedSection {...baseProps} desktopCard />)
    expect(screen.getByText(/not yet linked to a goal/i)).toBeInTheDocument()
  })
})
