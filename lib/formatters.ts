export const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')

export const fmtNav = (n: number) =>
  '₫ ' + n.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const fmtUnits = (n: number) =>
  n.toLocaleString('vi-VN', { maximumFractionDigits: 2 })

export const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

export const fmtShort = (n: number) => {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(0) + 'M'
  return n.toLocaleString('vi-VN')
}
