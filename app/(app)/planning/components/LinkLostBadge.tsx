'use client'

import { useId, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { GoalItem } from '@/lib/planning'

// The deposit a recurring saving was feeding has been deleted (#655).
//
// Nothing is broken — an unlinked saving still records a plain deposit when the
// month is marked saved — but the routing the user set up has quietly stopped,
// and a green monthly line is the only thing they would otherwise see. The
// handover flow (#638) makes this easy to walk into: opening a successor book
// moves the link onto the new book, so deleting that book is one click away
// from an unlinked plan.
//
// The badge is a button, not a `title`. The detail — what happens to the money
// now, and how to put it back — is the half worth reading, and a hover tooltip
// hides exactly that half from a phone, which is where this app is mostly used.
// Tapping it opens the sentence inline; hovering still shows it, for a mouse.
//
// One component for both layouts, because the two row files have drifted before
// (#603) and a warning that shows on the desktop table but not on a phone is
// worse than none — it is a warning the user has learned to expect.
export function LinkLostBadge({ item, isVI }: { item: GoalItem; isVI: boolean }) {
  const [open, setOpen] = useState(false)
  const generatedId = useId()
  if (!item.linkLost) return null

  const key = item.recurringId ?? generatedId
  const detailId = `plan-link-lost-detail-${key}`
  // Only a book was taking the monthly contribution. A link to a single term
  // deposit just told the maturity-combine picker which saving belonged to it,
  // and that contribution was already recorded as a standalone deposit — so
  // saying it "now" is one tells that user about a change that never happened.
  const detail = item.linkLostFromBook
    ? (isVI
      ? 'Sổ tích luỹ khoản này nạp vào đã bị xoá. Tiền hàng tháng giờ được ghi thành khoản gửi riêng — mở "Sửa kế hoạch định kỳ" để chọn sổ khác.'
      : 'The accumulating book this saving fed was deleted. Monthly contributions now record a standalone deposit — use "Edit recurring plan" to point it at another book.')
    : (isVI
      ? 'Sổ tiết kiệm liên kết với khoản này đã bị xoá, nên khoản này giờ không còn gắn với sổ nào — mở "Sửa kế hoạch định kỳ" để chọn sổ khác.'
      : 'The deposit this saving was linked to was deleted, so the saving is no longer linked to any deposit — use "Edit recurring plan" to point it at another.')

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3, minWidth: 0 }}>
      <button
        type="button"
        data-testid={item.recurringId ? `plan-link-lost-${item.recurringId}` : 'plan-link-lost'}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={detailId}
        title={detail}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0,
          // Vertical padding pulled back out as margin: the pill keeps its size
          // in the row while the thumb gets roughly twice the height to hit. It
          // is short of the 44px the row's menu button gets — this is a
          // disclosure next to that menu, not a primary action, and buying the
          // full target would push every plan line taller for a badge most rows
          // never show.
          padding: '7px 6px', margin: '-5px 0', borderRadius: 4, border: 'none',
          background: 'var(--c-warn-tint)', color: 'var(--c-warn)',
          fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap',
          fontFamily: 'inherit', cursor: 'pointer',
        }}
      >
        <AlertTriangle size={9} strokeWidth={2.6} />
        {isVI ? 'Sổ đã bị xoá' : 'Deposit deleted'}
      </button>
      {open && (
        <span
          id={detailId}
          data-testid={detailId}
          style={{ fontSize: 10, lineHeight: 1.45, color: 'var(--c-warn)', whiteSpace: 'normal' }}
        >
          {detail}
        </span>
      )}
    </span>
  )
}
