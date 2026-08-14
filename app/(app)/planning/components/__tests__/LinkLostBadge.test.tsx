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

// A deposit that was fully withdrawn is not a deposit that was deleted (#650).
// The row is still there — on the ledger, in the history — so telling the user
// it "was deleted" sends them looking for something that was never removed.
describe('LinkLostBadge — the deposit was closed, not deleted', () => {
  const closed: GoalItem = { ...lost, linkLostReason: 'closed' }

  it('says the deposit was closed', () => {
    render(<LinkLostBadge item={closed} isVI={false} />)
    const badge = screen.getByTestId('plan-link-lost-rs1')
    expect(badge.textContent).toMatch(/closed/i)
    expect(badge.textContent).not.toMatch(/deleted/i)
  })

  it('still names the consequence and the way out', async () => {
    render(<LinkLostBadge item={closed} isVI={false} />)
    await userEvent.click(screen.getByTestId('plan-link-lost-rs1'))

    const detail = screen.getByTestId('plan-link-lost-detail-rs1')
    expect(detail.textContent).not.toMatch(/deleted/i)
    expect(detail.textContent).toMatch(/standalone deposit/i)   // it was a book
    expect(detail.textContent).toMatch(/Edit recurring plan/i)
  })

  // The repair of a legacy closed book cannot know whether the target was a book:
  // withdraw_accumulating_book cleared the group before anyone asked. Unknown
  // must read as the half that is true, not as "it was only a term deposit".
  it('claims nothing about routing when the kind is unknown', async () => {
    render(<LinkLostBadge item={{ ...closed, linkLostFromBook: undefined }} isVI={false} />)
    await userEvent.click(screen.getByTestId('plan-link-lost-rs1'))

    const detail = screen.getByTestId('plan-link-lost-detail-rs1')
    expect(detail.textContent).not.toMatch(/standalone deposit/i)
    expect(detail.textContent).toMatch(/closed/i)
    expect(detail.textContent).toMatch(/Edit recurring plan/i)
  })

  it('says it in Vietnamese too, without the word for deleted', async () => {
    render(<LinkLostBadge item={closed} isVI />)
    const badge = screen.getByTestId('plan-link-lost-rs1')
    expect(badge.textContent).not.toMatch(/xoá/)
    await userEvent.click(badge)
    const detail = screen.getByTestId('plan-link-lost-detail-rs1')
    expect(detail.textContent).not.toMatch(/xoá/)
    expect(detail.textContent).toMatch(/Sửa kế hoạch định kỳ/)
  })

  // Everything stamped before the reason existed was a deletion, and the delete
  // trigger still says so — the old sentence must not drift.
  it('still says deleted when that is what happened', () => {
    render(<LinkLostBadge item={lost} isVI={false} />)
    expect(screen.getByTestId('plan-link-lost-rs1').textContent).toMatch(/deleted/i)
  })
})
