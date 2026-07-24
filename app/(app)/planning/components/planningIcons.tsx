// Small inline SVG icons shared across the mobile planning view and its extracted
// section/row components (#467).

export function EditIcon({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4l10-10-4-4L4 16z" /></svg>
}

export function TrashIcon({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
}
