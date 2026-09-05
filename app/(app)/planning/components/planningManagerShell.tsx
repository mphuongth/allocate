import type { CSSProperties } from 'react'

// The shell the two planning managers share (#689).
//
// FixedExpenseManager and RecurringSavingManager are the same screen with
// different fields: a list, a create/edit form, an effective-month range, a
// delete confirmation in two variants, and the same four style tokens. Each had
// its own copy, and the copies had already drifted — one said "Always" where the
// other said "Every month" — while the dialog work in #688 had to be done twice
// from one review.
//
// Small typed primitives, deliberately, not one configurable mega-component:
// what actually differs between an expense and a saving stays a prop, so the
// difference is visible at the call site rather than buried in a `variant`.

// ─── style tokens (work in both the desktop modal and the mobile sheet) ───────

export const inputStyle: CSSProperties = {
  width: '100%', padding: '10px 12px', fontSize: 16,
  border: '1px solid var(--c-line)', borderRadius: 10,
  background: 'var(--c-card-2)', color: 'var(--c-ink)', boxSizing: 'border-box',
}
export const labelStyle: CSSProperties = { fontSize: 13, color: 'var(--c-muted)', display: 'block', marginBottom: 4 }
export const ghostBtn: CSSProperties = {
  flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid var(--c-line)',
  background: 'var(--c-card)', color: 'var(--c-ink)', fontSize: 14, fontWeight: 500,
  cursor: 'pointer', fontFamily: 'inherit',
}
export const primaryBtn: CSSProperties = {
  flex: 2, padding: '10px 0', borderRadius: 10, border: 'none',
  background: 'var(--c-btn-primary)', color: '#fff', fontSize: 14, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit',
  // Centred as a row, not as text: these are PendingButtons, and a pending one
  // puts a loader beside the label.
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
}

// ─── the effective-month range ───────────────────────────────────────────────

const SHORT_MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SHORT_MONTHS_VI = ['Th1', 'Th2', 'Th3', 'Th4', 'Th5', 'Th6', 'Th7', 'Th8', 'Th9', 'Th10', 'Th11', 'Th12']

/** A stored date, trimmed to what `<input type="month">` reads and writes. */
export function toMonthInput(date: string | null): string {
  return date ? date.slice(0, 7) : ''
}

/**
 * How a rule's period reads on its row: "Mar 2026 → Jun 2026", with an ellipsis
 * for an open start and ∞ for an open end.
 *
 * `unbounded` is the caller's, because this is the one place the two managers
 * genuinely differ: an expense with no bounds is "Always", a recurring saving is
 * "Every month". Sharing the formatting without sharing the wording is the point.
 */
export function monthRangeLabel(
  from: string | null,
  to: string | null,
  isVI: boolean,
  unbounded: string,
): string {
  if (!from && !to) return unbounded
  const months = isVI ? SHORT_MONTHS_VI : SHORT_MONTHS_EN
  const fmtMonth = (d: string | null) => {
    if (!d) return null
    const [y, m] = d.split('-').map(Number)
    return `${months[m - 1]} ${y}`
  }
  return `${fmtMonth(from) || '…'} → ${fmtMonth(to) || '∞'}`
}

export type PlanningVariant = 'modal' | 'sheet'

