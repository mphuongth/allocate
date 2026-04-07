'use client'

import { AlertTriangle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface Props {
  open: boolean
  title: string
  message: string
  detail?: string
  confirmLabel?: string
  confirming?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmModal({ open, title, message, detail, confirmLabel, confirming, onConfirm, onCancel }: Props) {
  const tc = useTranslations('common')
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !confirming) onCancel() }}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            {title}
          </DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{message}</p>
          {detail && <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mt-1">{detail}</p>}
        </div>
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel} disabled={confirming}>{tc('cancel')}</Button>
          <Button className="flex-1 bg-red-600 hover:bg-red-700" onClick={onConfirm} disabled={confirming}>
            {confirming ? tc('loading') : (confirmLabel ?? tc('confirm'))}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
