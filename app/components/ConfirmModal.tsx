'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'

interface Props {
  title: string
  message: string
  detail?: string
  confirmLabel?: string
  confirming?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmModal({ title, message, detail, confirmLabel, confirming, onConfirm, onCancel }: Props) {
  const tc = useTranslations('common')
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !confirming) onCancel() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onCancel, confirming])

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === overlayRef.current && !confirming) onCancel() }}
    >
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-[400px] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
          <button
            onClick={onCancel}
            disabled={confirming}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {/* Body */}
        <div className="px-6 py-5">
          <p className="text-sm text-gray-600 dark:text-gray-400">{message}</p>
          {detail && <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mt-2">{detail}</p>}
        </div>
        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-gray-100 dark:border-gray-700 flex-shrink-0">
          <button
            onClick={onCancel}
            disabled={confirming}
            className="flex-1 h-9 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            {tc('cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={confirming}
            className="flex-1 h-9 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors disabled:opacity-50"
          >
            {confirming ? tc('loading') : (confirmLabel ?? tc('confirm'))}
          </button>
        </div>
      </div>
    </div>
  )
}
