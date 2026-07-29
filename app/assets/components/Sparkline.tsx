import type { ChartPoint } from './netWorthHistory'

// A fixed-width viewBox scaled to the container by `preserveAspectRatio="none"`,
// so the only thing a caller varies is the height.
export const SPARKLINE_WIDTH = 100

// Breathing room above and below the line so the stroke isn't clipped at the
// extremes of the range.
const STROKE_INSET = 3

/**
 * Net-worth trend line, shared by the mobile card and the desktop panel — the
 * two used byte-identical copies that differed only in height (#569).
 *
 * `height` is required rather than defaulted: the two call sites genuinely
 * differ, and a default would quietly hide which one a caller meant.
 */
export function sparklinePoints(values: number[], height: number): string {
  const rawMin = Math.min(...values)
  const rawMax = Math.max(...values)
  // Pad the range so a nearly-flat series still reads as a line rather than
  // hugging an edge. The fallbacks keep a flat or all-zero series finite.
  const pad = (rawMax - rawMin) * 0.15 || rawMax * 0.1 || 1
  const min = Math.max(0, rawMin - pad)
  const max = rawMax + pad
  const range = max - min || 1
  const usable = height - STROKE_INSET * 2

  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * SPARKLINE_WIDTH
      // SVG y grows downward, so a higher value sits at a smaller y.
      const y = height - ((v - min) / range) * usable - STROKE_INSET
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}

export default function Sparkline({
  data,
  positive,
  height,
}: {
  data: ChartPoint[]
  positive: boolean
  height: number
}) {
  // One point is not a line, and the x maths would divide by zero.
  if (data.length < 2) return null

  const points = sparklinePoints(data.map((d) => d.value), height)
  const color = positive ? 'var(--c-pos)' : 'var(--c-neg)'

  return (
    <svg
      viewBox={`0 0 ${SPARKLINE_WIDTH} ${height}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height, display: 'block' }}
    >
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
