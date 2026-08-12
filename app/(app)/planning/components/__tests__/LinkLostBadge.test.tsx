import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LinkLostBadge } from '../LinkLostBadge'
import type { GoalItem } from '@/lib/planning'

// The badge says a link was lost; the part worth reading is what happens now and
// how to undo it (#655). That lived only in a native `title`, which a phone
// cannot open — so on the layout this app is mostly used in, the warning named a
// problem and withheld the answer.
const lost: GoalItem = {
  name: 'VCB Savings', type: 'bank', amount: 2_000_000,
  isRecurring: true, recurringId: 'rs1', linkLost: true, linkLostFromBook: true,
}

describe('LinkLostBadge', () => {
  it('says nothing for a saving that has not lost a link', () => {
    render(<LinkLostBadge item={{ ...lost, linkLost: false }} isVI={false} />)
    expect(screen.queryByTestId('plan-link-lost-rs1')).toBeNull()
  })

  it('opens the consequence and the way out on tap', async () => {
    render(<LinkLostBadge item={lost} isVI={false} />)
    expect(screen.queryByTestId('plan-link-lost-detail-rs1')).toBeNull()

    await userEvent.click(screen.getByTestId('plan-link-lost-rs1'))

    const detail = screen.getByTestId('plan-link-lost-detail-rs1')
    expect(detail.textContent).toMatch(/standalone deposit/i)   // what happens now
    expect(detail.textContent).toMatch(/Edit recurring plan/i)  // how to fix it
  })

  it('closes again on a second tap', async () => {
    render(<LinkLostBadge item={lost} isVI={false} />)
    const badge = screen.getByTestId('plan-link-lost-rs1')

    await userEvent.click(badge)
    expect(badge).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(badge)

    expect(badge).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('plan-link-lost-detail-rs1')).toBeNull()
  })

  // A link to a plain term deposit never routed the monthly contribution
  // anywhere — it only told the maturity picker which saving belonged to that
  // deposit. Telling that user their contributions "now" record a standalone
  // deposit describes a change that did not happen.
  it('does not claim the routing changed when the link was a term deposit', async () => {
    render(<LinkLostBadge item={{ ...lost, linkLostFromBook: false }} isVI={false} />)
    await userEvent.click(screen.getByTestId('plan-link-lost-rs1'))

    const detail = screen.getByTestId('plan-link-lost-detail-rs1')
    expect(detail.textContent).not.toMatch(/standalone deposit/i)
    expect(detail.textContent).toMatch(/no longer linked/i)
    expect(detail.textContent).toMatch(/Edit recurring plan/i)  // still actionable
  })

  it('carries the Vietnamese copy too', async () => {
    render(<LinkLostBadge item={lost} isVI />)
    await userEvent.click(screen.getByTestId('plan-link-lost-rs1'))
    expect(screen.getByTestId('plan-link-lost-detail-rs1').textContent).toMatch(/Sửa kế hoạch định kỳ/)
  })
})
