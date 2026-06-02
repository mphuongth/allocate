// Shared helpers for the insurance views — DesktopInsuranceDetail and
// DesktopInsuranceList (desktop) plus InsuranceCard (mobile). They render the
// same member data with different chrome, so the status colours, the
// "paid this year → completed" rule and the desktop status labels live here to
// stay in sync.

import { insurancePaidYear } from '@/lib/finance'

// Relationship / coverage options for the add & edit member forms — the single
// source of truth so both stay in sync. "Spouse" covers husband/wife (the old
// separate Husband/Wife options were folded into it).
export const COVERAGE_OPTIONS: { value: string; label: string; labelVi: string }[] = [
  { value: 'Self', label: 'Self', labelVi: 'Bản thân' },
  { value: 'Spouse', label: 'Spouse', labelVi: 'Vợ/Chồng' },
  { value: 'Child', label: 'Child', labelVi: 'Con' },
  { value: 'Parent', label: 'Parent', labelVi: 'Cha/Mẹ' },
  { value: 'Other', label: 'Other', labelVi: 'Khác' },
]

// Dot / badge colour by status — identical across all insurance views.
export const STATUS_COLOR: Record<string, string> = {
  on_track:  'var(--c-muted)',
  upcoming:  'var(--c-warn)',
  overdue:   'var(--c-neg)',
  completed: 'var(--c-pos)',
  ready:     'var(--c-navy)',
}

// Progress-bar colour. The compact list/card paint a "ready" member amber to
// nudge action; the detail view paints it navy to match its richer
// "ready to pay" note (BAR_COLOR_DETAIL overrides only the ready key).
export const BAR_COLOR: Record<string, string> = {
  on_track:  'var(--c-warn)',
  upcoming:  'var(--c-warn)',
  overdue:   'var(--c-neg)',
  completed: 'var(--c-pos)',
  ready:     'var(--c-warn)',
}

export const BAR_COLOR_DETAIL: Record<string, string> = { ...BAR_COLOR, ready: 'var(--c-navy)' }

// Once the current year's premium is settled the member presents as "completed"
// (paid) regardless of the recomputed due-date status, and we surface the paid
// year for "Paid for {year}" framing.
export function insurancePaidState(status: string, lastPaymentDate?: string | null) {
  const paidYear = insurancePaidYear(lastPaymentDate ?? null)
  const effectiveStatus = paidYear !== null ? 'completed' : status
  return { paidYear, effectiveStatus }
}

// Hardcoded status labels for the desktop views. The mobile InsuranceCard uses
// next-intl instead, so it intentionally does not share this.
export function insuranceStatusLabel(status: string, isVi: boolean): string {
  const labels: Record<string, string> = isVi
    ? { on_track: 'Chưa đến hạn', completed: 'Đã thanh toán', overdue: 'Quá hạn', upcoming: 'Sắp đến hạn', ready: 'Đã tích lũy đủ' }
    : { on_track: 'Not due', completed: 'Paid', overdue: 'Overdue', upcoming: 'Due soon', ready: 'Ready to pay' }
  return labels[status] ?? status
}
