export const fmt = (n: number) => '₫ ' + Math.round(n).toLocaleString('vi-VN')

export const fmtCompact = (n: number) => {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000_000) return sign + (abs / 1_000_000_000).toFixed(1) + 'B ₫'
  if (abs >= 1_000_000) return sign + (abs / 1_000_000).toFixed(1) + 'M ₫'
  return fmt(n)
}
