import type { CSSProperties } from 'react'

// Shared touch-target floor for icon-only buttons (sheet/modal close, row
// edit/delete, kebab menus). WCAG 2.5.5 asks for a ≥44×44px hit area; these
// buttons previously sat at ~24–30px (a small icon with 5–6px padding). Spread
// onto a button's existing style — the icon keeps its own size, centered within
// the padded target. Matches the inline `minWidth:44, minHeight:44` pattern the
// Plan-page a11y pass adopted (#410), so the two audits stay consistent.
export const iconHit: CSSProperties = {
  minWidth: 44,
  minHeight: 44,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
}
