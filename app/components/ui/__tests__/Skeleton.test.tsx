import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Skeleton } from '../Skeleton'

describe('Skeleton', () => {
  it('renders the shimmer primitive class', () => {
    const { container } = render(<Skeleton />)
    expect(container.firstChild).toHaveClass('sk')
  })

  it('is hidden from assistive tech', () => {
    const { container } = render(<Skeleton />)
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('applies width and height through inline style', () => {
    const { container } = render(<Skeleton width={140} height={32} />)
    expect(container.firstChild).toHaveStyle({ width: '140px', height: '32px' })
  })

  it('passes string dimensions through verbatim', () => {
    const { container } = render(<Skeleton width="60%" height={12} />)
    expect(container.firstChild).toHaveStyle({ width: '60%' })
  })

  it('adds the round modifier when round', () => {
    const { container } = render(<Skeleton round />)
    expect(container.firstChild).toHaveClass('round')
  })

  it('adds the card modifier when card', () => {
    const { container } = render(<Skeleton card />)
    expect(container.firstChild).toHaveClass('card')
  })

  it('merges an extra className', () => {
    const { container } = render(<Skeleton className="mb-2" />)
    const el = container.firstChild as HTMLElement
    expect(el).toHaveClass('sk')
    expect(el).toHaveClass('mb-2')
  })
})
