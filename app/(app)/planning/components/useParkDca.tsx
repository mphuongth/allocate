'use client'

import { useState } from 'react'
import ParkDcaSheet, { type ParkDcaTarget } from '@/app/assets/components/ParkDcaSheet'
import PlanningDeleteConfirm from './PlanningDeleteConfirm'
import type { PlanningVariant } from './planningManagerShell'
import type { GoalItem } from '@/lib/planning'

// The two dialogs a fund DCA line opens on either plan view: "Gửi tiết kiệm
// thay" (park this month's DCA in a term deposit — ParkDcaSheet), and the
// confirm before undoing it, which deletes that deposit.
//
// Both take the goal's items: the sheet offers the goal's other DCA lines still
// waiting to be bought, and the confirm names every line the deposit carries —
// deleting it puts all of them back.
export function useParkDca({ planId, isVI, variant, onRefresh, onToast, unparkDca }: {
  planId: string | null | undefined
  isVI: boolean
  variant: PlanningVariant
  onRefresh: () => void
  onToast: (msg: string) => void
  unparkDca: (item: GoalItem) => Promise<void>
}) {
  const [parkTarget, setParkTarget] = useState<ParkDcaTarget | null>(null)
  const [unpark, setUnpark] = useState<{ item: GoalItem; lines: string[] } | null>(null)
  const [deleting, setDeleting] = useState(false)

  function openPark(item: GoalItem, goalItems: GoalItem[] = []) {
    if (!planId || !item.fundId) return
    const others = goalItems
      .filter((o) => o.isFundDca && o.fundId && o.fundId !== item.fundId
        && !o.recorded && !o.skipped && !o.parkedIn && o.amount > 0)
      .map((o) => ({ fundId: o.fundId as string, fundName: o.name, amount: o.amount }))
    setParkTarget({ planId, fundId: item.fundId, fundName: item.name, amount: item.amount, others })
  }

  function askUnpark(item: GoalItem, goalItems: GoalItem[] = []) {
    const dep = item.parkedIn?.transactionId
    const lines = goalItems.filter((o) => dep && o.parkedIn?.transactionId === dep).map((o) => o.name)
    setUnpark({ item, lines: lines.length > 0 ? lines : [item.name] })
  }

  const dialogs = (
    <>
      <ParkDcaSheet
        target={parkTarget}
        isVi={isVI}
        onClose={() => setParkTarget(null)}
        onDone={(names) => {
          onRefresh()
          onToast(isVI ? `Đã gửi tiết kiệm thay ${names.join(', ')}` : `Parked ${names.join(', ')} in a deposit`)
        }}
      />
      {unpark && (
        <PlanningDeleteConfirm
          variant={variant}
          testIdPrefix="park"
          title={isVI ? 'Huỷ gửi tiết kiệm?' : 'Undo the deposit?'}
          description={isVI
            ? `Sổ “${unpark.item.parkedIn?.name ?? 'tiết kiệm'}” sẽ bị xoá và ${unpark.lines.length > 1 ? 'các dòng' : 'dòng'} DCA ${unpark.lines.join(', ')} quay lại chờ mua.`
            : `The deposit “${unpark.item.parkedIn?.name ?? 'savings'}” is deleted and the ${unpark.lines.join(', ')} DCA ${unpark.lines.length > 1 ? 'lines ask' : 'line asks'} to be bought again.`}
          cancelLabel={isVI ? 'Giữ lại' : 'Keep it'}
          confirmLabel={isVI ? 'Xoá sổ' : 'Delete deposit'}
          deletingLabel={isVI ? 'Đang xoá…' : 'Deleting…'}
          deleting={deleting}
          onCancel={() => setUnpark(null)}
          onConfirm={async () => {
            setDeleting(true)
            try { await unparkDca(unpark.item) } finally { setDeleting(false); setUnpark(null) }
          }}
        />
      )}
    </>
  )

  return { openPark, askUnpark, dialogs }
}
