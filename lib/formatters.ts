export const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')

export const fmtNav = (n: number) =>
  '₫ ' + n.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const fmtUnits = (n: number) =>
  n.toLocaleString('vi-VN', { maximumFractionDigits: 2 })

export const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

// Compact money for dense lists: 15.5M ₫, 350K ₫, 1.2B ₫
export const fmtCompact = (n: number) => {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000_000) return sign + (abs / 1_000_000_000).toFixed(1) + 'B ₫'
  if (abs >= 1_000_000) return sign + (abs / 1_000_000).toFixed(1) + 'M ₫'
  if (abs >= 1_000) return sign + (abs / 1_000).toFixed(0) + 'K ₫'
  return sign + Math.round(abs).toLocaleString('vi-VN') + ' ₫'
}
