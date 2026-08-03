import type { CSSProperties } from 'react'

interface SkeletonProps {
  /** Width — number is treated as px, string passed through (e.g. '60%'). */
  width?: number | string
  /** Height — number is treated as px, string passed through. */
  height?: number | string
  /** Pill / circle radius. */
  round?: boolean
  /** Card-sized radius (var(--r-card)). */
  card?: boolean
  className?: string
  style?: CSSProperties
}

/**
 * Skeleton — the single shimmering primitive every skeleton screen composes
 * from. A warm shimmering rectangle; `round` for pills/circles, `card` for card
 * radius. Decorative, so it's hidden from assistive tech. See issue #235.
 */
export function Skeleton({ width, height, round, card, className, style }: SkeletonProps) {
  const cls = ['sk', round && 'round', card && 'card', className].filter(Boolean).join(' ')
  return <div className={cls} aria-hidden="true" style={{ width, height, ...style }} />
}
