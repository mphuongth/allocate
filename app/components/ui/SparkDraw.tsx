interface SparkDrawProps {
  /** Stroke colour. Defaults to the positive accent; pass a muted line for skeletons. */
  color?: string
}

/**
 * Sparkline placeholder whose stroke draws itself in, looping — the "chart
 * drawing-in" loading state from the design (issue #235). Decorative.
 */
export function SparkDraw({ color = 'var(--c-pos)' }: SparkDrawProps) {
  return (
    <svg className="spark-draw" viewBox="0 0 240 48" width="100%" height={48} fill="none" aria-hidden="true">
      <path
        d="M0 36 Q 20 32 40 28 T 80 22 T 120 24 T 160 14 T 200 18 T 240 6"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
