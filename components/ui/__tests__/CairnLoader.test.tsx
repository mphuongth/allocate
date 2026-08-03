import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { CairnLoader } from '../CairnLoader'

describe('CairnLoader', () => {
  it('renders three stacking stones', () => {
    const { container } = render(<CairnLoader />)
    expect(container.querySelectorAll('.cairn-loader .stone')).toHaveLength(3)
  })

  it('has an accessible status role and label', () => {
    const { getByRole } = render(<CairnLoader />)
    const el = getByRole('status')
    expect(el).toHaveAttribute('aria-label', 'Loading')
  })

  it('lets the caller override the accessible label', () => {
    const { getByRole } = render(<CairnLoader label="Syncing balances" />)
    expect(getByRole('status')).toHaveAttribute('aria-label', 'Syncing balances')
  })

  it('applies the size token to the wrapper', () => {
    const { getByRole } = render(<CairnLoader size={56} />)
    expect(getByRole('status')).toHaveStyle({ '--s': '56px' })
  })

  it('defaults to a 24px size token', () => {
    const { getByRole } = render(<CairnLoader />)
    expect(getByRole('status')).toHaveStyle({ '--s': '24px' })
  })

  it('applies the variant as a modifier class', () => {
    const { getByRole } = render(<CairnLoader variant="on-dark" />)
    expect(getByRole('status').className).toContain('on-dark')
  })

  it('adds no variant modifier class by default', () => {
    const { getByRole } = render(<CairnLoader />)
    const cls = getByRole('status').className
    expect(cls).not.toContain('on-dark')
    expect(cls).not.toContain('muted')
    expect(cls).not.toContain('pos')
  })

  it('merges an extra className', () => {
    const { getByRole } = render(<CairnLoader className="my-loader" />)
    expect(getByRole('status').className).toContain('my-loader')
  })
})
