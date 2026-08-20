import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { monthRangeLabel, toMonthInput } from '../planningManagerShell'
import EffectiveMonthFields from '../EffectiveMonthFields'
import PlanningDeleteConfirm from '../PlanningDeleteConfirm'

// Guard for #689. FixedExpenseManager and RecurringSavingManager each carried
// their own copy of the same shell — the month range fields, the delete
// confirmation in two variants, the period label, the style tokens. The copies
// had already drifted (one said "Always", the other "Every month") and the a11y
// work in #688 had to be done twice, in two places, from the same review.
//
// These are small typed primitives, not one configurable mega-component: what
// differs between the two features stays a prop.

describe('monthRangeLabel (#689)', () => {
  it('uses the caller\'s own wording when a rule has no bounds', () => {
    // The one place the two managers legitimately differ: a fixed expense is
    // "Always", a recurring saving is "Every month".
    expect(monthRangeLabel(null, null, false, 'Always')).toBe('Always')
    expect(monthRangeLabel(null, null, true, 'Luôn áp dụng')).toBe('Luôn áp dụng')
  })

  it('reads an open-ended start as "from <month>"', () => {
    expect(monthRangeLabel('2026-03-01', null, false, 'Always')).toBe('Mar 2026 → ∞')
  })

  it('marks a missing start with an ellipsis rather than inventing one', () => {
    expect(monthRangeLabel(null, '2026-06-01', false, 'Always')).toBe('… → Jun 2026')
  })

  it('renders both ends when the rule is bounded', () => {
    expect(monthRangeLabel('2026-03-01', '2026-06-01', false, 'Always')).toBe('Mar 2026 → Jun 2026')
  })

  it('uses Vietnamese short months', () => {
    expect(monthRangeLabel('2026-03-01', '2026-06-01', true, 'Luôn')).toBe('Th3 2026 → Th6 2026')
  })
})

describe('toMonthInput (#689)', () => {
  it('trims a stored date down to what <input type="month"> wants', () => {
    expect(toMonthInput('2026-06-01')).toBe('2026-06')
  })

  it('answers empty for a rule with no bound', () => {
    expect(toMonthInput(null)).toBe('')
  })
})

describe('EffectiveMonthFields (#689)', () => {
  const props = {
    idPrefix: 'fe',
    fromLabel: 'Effective from',
    toLabel: 'Effective to',
    from: '',
    to: '',
    onFromChange: () => {},
    onToChange: () => {},
  }

  it('labels each field and ties the label to its input', () => {
    render(<EffectiveMonthFields {...props} />)

    // getByLabelText only resolves through a real htmlFor/id pair.
    expect(screen.getByLabelText('Effective from')).toHaveAttribute('id', 'fe-from')
    expect(screen.getByLabelText('Effective to')).toHaveAttribute('id', 'fe-to')
  })

  it('keeps the per-feature test ids the specs already use', () => {
    render(<EffectiveMonthFields {...props} idPrefix="rs" />)

    expect(screen.getByTestId('rs-from')).toBeInTheDocument()
    expect(screen.getByTestId('rs-to')).toBeInTheDocument()
  })

  it('reports edits back with the month the user picked', () => {
    const onFromChange = vi.fn()
    render(<EffectiveMonthFields {...props} onFromChange={onFromChange} />)

    fireEvent.change(screen.getByTestId('fe-from'), { target: { value: '2026-04' } })

    expect(onFromChange).toHaveBeenCalledWith('2026-04')
  })
})

describe('PlanningDeleteConfirm (#689)', () => {
  const props = {
    variant: 'modal' as const,
    testIdPrefix: 'fe',
    title: 'Delete this expense?',
    description: 'Rent — ₫ 8500000',
    cancelLabel: 'Cancel',
    confirmLabel: 'Delete',
    deleting: false,
    onCancel: () => {},
    onConfirm: () => {},
  }

  for (const variant of ['modal', 'sheet'] as const) {
    it(`is a named modal dialog in the ${variant} variant`, () => {
      render(<PlanningDeleteConfirm {...props} variant={variant} />)

      const dialog = screen.getByRole('dialog', { name: 'Delete this expense?' })
      expect(dialog).toHaveAttribute('aria-modal', 'true')
    })

    it(`keeps the feature's overlay and confirm test ids in the ${variant} variant`, () => {
      render(<PlanningDeleteConfirm {...props} variant={variant} testIdPrefix="rs" />)

      expect(screen.getByTestId('rs-delete-overlay')).toBeInTheDocument()
      expect(screen.getByTestId('rs-delete-confirm')).toBeInTheDocument()
    })
  }

  it('names what is about to be destroyed', () => {
    render(<PlanningDeleteConfirm {...props} />)

    expect(screen.getByText('Rent — ₫ 8500000')).toBeInTheDocument()
  })

  it('confirms and cancels through the callbacks it was given', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<PlanningDeleteConfirm {...props} onConfirm={onConfirm} onCancel={onCancel} />)

    await userEvent.click(screen.getByTestId('fe-delete-confirm'))
    expect(onConfirm).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('holds itself open while the delete is in flight', async () => {
    // Clicking away mid-request would hide the confirmation while the row is
    // still going.
    const onCancel = vi.fn()
    render(<PlanningDeleteConfirm {...props} deleting onCancel={onCancel} />)

    await userEvent.click(screen.getByTestId('fe-delete-overlay'))

    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByTestId('fe-delete-confirm')).toBeDisabled()
  })

  it('closes on Escape and traps focus — the contract, inherited once', async () => {
    const onCancel = vi.fn()
    render(<PlanningDeleteConfirm {...props} onCancel={onCancel} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toContainElement(document.activeElement as HTMLElement)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('lets a feature add its own warning below the description', () => {
    // Neither manager needs this today; it is the seam that keeps the shared
    // shell from becoming the reason a feature cannot say something extra
    // before destroying a row.
    render(<PlanningDeleteConfirm {...props} extra={<p>this unlinks 2 plan months</p>} />)

    expect(screen.getByText('this unlinks 2 plan months')).toBeInTheDocument()
  })
})
