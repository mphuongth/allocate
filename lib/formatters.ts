export const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')

export const fmtNav = (n: number) =>
  '₫ ' + n.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const fmtUnits = (n: number) =>
  n.toLocaleString('vi-VN', { maximumFractionDigits: 2 })

export const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

/**
 * Coarse "N ago" for the NAV-updated label under the net-worth figure. Reports
 * the largest whole unit and stops at days — this labels a price sync, so
 * anything older than a few days reads the same to the user either way.
 *
 * Any locale that isn't Vietnamese renders in English.
 */
export function fmtTimeAgo(isoString: string, locale: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diffMs / 60_000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  const isVi = locale === 'vi'
  if (days > 0) return isVi ? `${days} ngày trước` : `${days}d ago`
  if (hours > 0) return isVi ? `${hours} giờ trước` : `${hours}h ago`
  return isVi ? `${mins} phút trước` : `${mins}m ago`
}

// Compact money for dense lists: 15.5M ₫, 350K ₫, 1.2B ₫
export const fmtCompact = (n: number) => {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000_000) return sign + (abs / 1_000_000_000).toFixed(1) + 'B ₫'
  if (abs >= 1_000_000) return sign + (abs / 1_000_000).toFixed(1) + 'M ₫'
  if (abs >= 1_000) return sign + (abs / 1_000).toFixed(0) + 'K ₫'
  return sign + Math.round(abs).toLocaleString('vi-VN') + ' ₫'
}
