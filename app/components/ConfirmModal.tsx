'use client'

interface Props {
  title: string
  message: string
  detail?: string
  confirmLabel?: string
  confirming?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmModal({ title, message, detail, confirmLabel = 'Xác nhận', confirming, onConfirm, onCancel }: Props) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm p-6 border border-gray-100 dark:border-gray-700">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-2">{title}</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">{message}</p>
        {detail && <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-4">{detail}</p>}
        <div className={detail ? '' : 'mt-4'}>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              disabled={confirming}
              className="flex-1 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              Hủy
            </button>
            <button
              onClick={onConfirm}
              disabled={confirming}
              className="flex-1 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              {confirming ? 'Đang xử lý...' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
