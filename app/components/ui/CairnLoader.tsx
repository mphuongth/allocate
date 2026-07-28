import type { CSSProperties } from 'react'

export type CairnLoaderVariant = '' | 'on-dark' | 'muted' | 'pos'

interface CairnLoaderProps {
  /** Root size token in px. XS≈14, S≈20, M≈32, L≈56. Defaults to 24. */
  size?: number
  /** Colour variant. Default navy; `on-dark` inverts; `muted` for inline placeholders; `pos` for positive flows. */
  variant?: CairnLoaderVariant
  /** Accessible label announced by screen readers. */
  label?: string
  className?: string
}

/**
 * Cairn stone loader — the brand-tied loading indicator. Three stones stack and
 * pulse in sequence. Swaps in anywhere a generic spinner would otherwise go, at
 * any size, so the whole app speaks one loading vocabulary. See issue #235.
 */
export function CairnLoader({ size = 24, variant = '', label = 'Loading', className }: CairnLoaderProps) {
  const cls = ['cairn-loader', variant, className].filter(Boolean).join(' ')
  return (
    <span className={cls} role="status" aria-label={label} style={{ '--s': `${size}px` } as CSSProperties}>
      <span className="stone s1" aria-hidden="true" />
      <span className="stone s2" aria-hidden="true" />
      <span className="stone s3" aria-hidden="true" />
    </span>
  )
}
