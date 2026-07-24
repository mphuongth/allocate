'use client'

// The combine flow's "new cycle" fields (#467): the new term + rate, the new
// maturity date (anchored to old-maturity + term, with a reset), the mark-recurring-
// deposited guard, and the new-cycle preview. The sheet owns the state + the derived
// newPrincipal/newMaturity (from maturityResolveModel) and passes them in.
import { fmt, fmtCompact } from '@/lib/formatters'
import { formatIntVN, parseIntVN, formatDecimalVN, parseDecimalVN } from '@/lib/numberFormat'
import { fieldLabel, moneyInput, dateInput } from './maturityResolveFields'

export function CombineNewCycleSection({
  term, setTerm, rate, setRate, newMaturity, newMaturityFmt, baseDate, setMaturityOverride,
  dateTouched, maturityValid, linkedAmt, pickedCand, markFulfilled, setMarkFulfilled, newPrincipal, t,
}: {
  term: string
  setTerm: (v: string) => void
  rate: string
  setRate: (v: string) => void
  newMaturity: string
  newMaturityFmt: string
  baseDate: string
  setMaturityOverride: (v: string | null) => void
  dateTouched: boolean
  maturityValid: boolean
  linkedAmt: number
  pickedCand: { saving_id: string } | null
  markFulfilled: boolean
  setMarkFulfilled: (v: boolean) => void
  newPrincipal: number
  t: {
    newTerm: string; newRate: string; mo: string; perYr: string
    newMaturityLabel: string; resetDate: string; maturityTooEarly: string
    markDeposited: (amt: string) => string; newCycle: string
  }
}) {
  return (
    <>
          {/* New term + rate */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={fieldLabel}>{t.newTerm}</div>
              <div style={{ position: 'relative' }}>
                <input type="text" inputMode="numeric" value={formatIntVN(term)} onChange={(e) => setTerm(parseIntVN(e.target.value))} style={moneyInput} />
                <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--c-muted)', pointerEvents: 'none' }}>{t.mo}</span>
              </div>
            </div>
            <div>
              <div style={fieldLabel}>{t.newRate}</div>
              <div style={{ position: 'relative' }}>
                <input type="text" inputMode="decimal" value={formatDecimalVN(rate)} onChange={(e) => setRate(parseDecimalVN(e.target.value))} style={moneyInput} />
                <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--c-muted)', pointerEvents: 'none' }}>%/{t.perYr}</span>
              </div>
            </div>
          </div>

          {/* New maturity date — same anchor (old maturity + term) as a renewal */}
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ ...fieldLabel, marginBottom: 0 }}>{t.newMaturityLabel}</span>
              {dateTouched && (
                <button type="button" onClick={() => setMaturityOverride(null)}
                  style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-navy)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                  {t.resetDate}
                </button>
              )}
            </div>
            <input data-testid="maturity-combine-date" type="date" value={newMaturity} min={baseDate} onChange={(e) => setMaturityOverride(e.target.value)} style={dateInput} />
            {!maturityValid && <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--c-neg)', lineHeight: 1.4 }}>{t.maturityTooEarly}</p>}
          </div>

          {/* Mark this month's recurring as deposited (prevents double-count) */}
          {linkedAmt > 0 && pickedCand && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', background: 'var(--c-pos-tint)', borderRadius: 10, fontSize: 12.5, color: 'var(--c-ink)', lineHeight: 1.4, cursor: 'pointer' }}>
              <input data-testid="maturity-mark-fulfilled" type="checkbox" checked={markFulfilled} onChange={(e) => setMarkFulfilled(e.target.checked)} style={{ accentColor: 'var(--c-pos)', width: 16, height: 16, flexShrink: 0 }} />
              <span>{t.markDeposited(fmtCompact(linkedAmt))}</span>
            </label>
          )}

          {/* Preview */}
          <div style={{ border: '1px solid var(--c-line)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', background: 'var(--c-navy-tint)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--c-navy)' }}>{t.newCycle}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span data-testid="maturity-new-principal" style={{ fontSize: 16, fontWeight: 700, color: 'var(--c-navy)', fontVariantNumeric: 'tabular-nums' }}>{fmt(newPrincipal)}</span>
                {rate !== '' && <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: 'var(--c-card)', color: 'var(--c-navy)' }}>{rate}%/{t.perYr}</span>}
              </span>
            </div>
            <div style={{ background: 'var(--c-card)', padding: '9px 12px' }}>
              <div style={{ fontSize: 10, color: 'var(--c-muted)' }}>{t.newMaturityLabel}</div>
              <div data-testid="maturity-new-date" style={{ fontSize: 13, fontWeight: 600, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{newMaturityFmt}</div>
            </div>
          </div>
    </>
  )
}
