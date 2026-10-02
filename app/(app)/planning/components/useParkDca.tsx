'use client'

import { useState } from 'react'
import ParkDcaSheet, { type ParkDcaTarget } from '@/app/assets/components/ParkDcaSheet'
import PlanningDeleteConfirm from './PlanningDeleteConfirm'
import type { PlanningVariant } from './planningManagerShell'
import type { GoalItem } from '@/lib/planning'

// The two dialogs a fund DCA line opens on either plan view: "Gửi tiết kiệm
// thay" (park this month's DCA in a term deposit — ParkDcaSheet), and the
// confirm before undoing it, which deletes that deposit.
export function useParkDca({ planId, isVI, variant, onRefresh, onToast, unparkDca }: {
  planId: string | null | undefined
  isVI: boolean
  variant: PlanningVariant
  onRefresh: () => void
  onToast: (msg: string) => void
  unparkDca: (item: GoalItem) => Promise<void>
}) {
  const [parkTarget, setParkTarget] = useState<ParkDcaTarget | null>(null)
  const [unpark, setUnpark] = useState<GoalItem | null>(null)
  const [deleting, setDeleting] = useState(false)

  function openPark(item: GoalItem) {
    if (!planId || !item.fundId) return
    setParkTarget({ planId, fundId: item.fundId, fundName: item.name, amount: item.amount })
  }

  const dialogs = (
    <>
      <ParkDcaSheet
        target={parkTarget}
        isVi={isVI}
        onClose={() => setParkTarget(null)}
        onDone={() => {
          onRefresh()
          if (parkTarget) onToast(isVI ? `Đã gửi tiết kiệm thay ${parkTarget.fundName}` : `Parked ${parkTarget.fundName} in a deposit`)
        }}
      />
      {unpark && (
        <PlanningDeleteConfirm
          variant={variant}
          testIdPrefix="park"
          title={isVI ? 'Huỷ gửi tiết kiệm?' : 'Undo the deposit?'}
          description={isVI
            ? `Sổ “${unpark.parkedIn?.name ?? 'tiết kiệm'}” sẽ bị xoá và dòng DCA ${unpark.name} quay lại chờ mua.`
            : `The deposit “${unpark.parkedIn?.name ?? 'savings'}” is deleted and the ${unpark.name} DCA line asks to be bought again.`}
          cancelLabel={isVI ? 'Giữ lại' : 'Keep it'}
          confirmLabel={isVI ? 'Xoá sổ' : 'Delete deposit'}
          deletingLabel={isVI ? 'Đang xoá…' : 'Deleting…'}
          deleting={deleting}
          onCancel={() => setUnpark(null)}
          onConfirm={async () => {
            setDeleting(true)
            try { await unparkDca(unpark) } finally { setDeleting(false); setUnpark(null) }
          }}
        />
      )}
    </>
  )

  return { openPark, askUnpark: setUnpark, dialogs }
}
