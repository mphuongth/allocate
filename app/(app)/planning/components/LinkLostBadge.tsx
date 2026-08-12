'use client'

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
// One component for both layouts, because the two row files have drifted before
// (#603) and a warning that shows on the desktop table but not on a phone is
// worse than none — it is a warning the user has learned to expect.
export function LinkLostBadge({ item, isVI }: { item: GoalItem; isVI: boolean }) {
  if (!item.linkLost) return null
  return (
    <span
      data-testid={item.recurringId ? `plan-link-lost-${item.recurringId}` : 'plan-link-lost'}
      title={isVI
        ? 'Sổ tiết kiệm khoản này nạp vào đã bị xoá. Tiền hàng tháng giờ được ghi thành khoản gửi riêng — sửa kế hoạch định kỳ để chọn sổ khác.'
        : 'The deposit this saving fed was deleted. The monthly contribution now records a standalone deposit — edit the recurring plan to point it at another book.'}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0,
        padding: '1px 5px', borderRadius: 4,
        background: 'var(--c-warn-tint)', color: 'var(--c-warn)',
        fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap',
      }}
    >
      <AlertTriangle size={9} strokeWidth={2.6} />
      {isVI ? 'Sổ đã bị xoá' : 'Deposit deleted'}
    </span>
  )
}
