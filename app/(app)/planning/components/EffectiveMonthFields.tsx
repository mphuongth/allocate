'use client'

import { inputStyle, labelStyle } from './planningManagerShell'

// The "effective from / effective to" pair both planning managers ask for
// (#689). Identical in both but for the ids and the label copy — which is
// exactly what a prop is for.
export default function EffectiveMonthFields({
  idPrefix,
  fromLabel,
  toLabel,
  from,
  to,
  onFromChange,
  onToChange,
}: {
  /** 'fe' or 'rs' — keeps each feature's existing ids and test ids. */
  idPrefix: string
  fromLabel: string
  toLabel: string
  from: string
  to: string
  onFromChange: (value: string) => void
  onToChange: (value: string) => void
}) {
  return (
    // minmax(0,1fr), not 1fr: a month input has a wide intrinsic minimum and
    // would otherwise push the grid past its container on a narrow phone.
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 10 }}>
      <div>
        <label htmlFor={`${idPrefix}-from`} style={labelStyle}>{fromLabel}</label>
        <input
          id={`${idPrefix}-from`}
          data-testid={`${idPrefix}-from`}
          type="month"
          value={from}
          onChange={(e) => onFromChange(e.target.value)}
          style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums', minWidth: 0 }}
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-to`} style={labelStyle}>{toLabel}</label>
        <input
          id={`${idPrefix}-to`}
          data-testid={`${idPrefix}-to`}
          type="month"
          value={to}
          onChange={(e) => onToChange(e.target.value)}
          style={{ ...inputStyle, fontVariantNumeric: 'tabular-nums', minWidth: 0 }}
        />
      </div>
    </div>
  )
}
