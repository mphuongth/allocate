'use client'

// The recurring-fold + re-deposit fields at the top of the combine flow (#467):
// pick which recurring saving to fold in (when ambiguous / multiple), the interest
// received, a cash-flow recap of what lands in the account, and the editable
// re-deposit amount (suggested = principal + interest + recurring). The sheet owns
// the state and passes it in; business math stays in maturityResolveModel.
import { Check, Wallet } from 'lucide-react'
import { fmt, fmtCompact } from '@/lib/formatters'
import type { RecurringLinkResult } from '@/lib/recurringLink'
import { fieldLabel, MoneyField, MoneyInputCore } from './maturityResolveFields'

export function RecurringRedepositSection({
  combineLink, pickedCand, setPickedSavingId, interest, setInterest,
  principal, iNum, linkedAmt, redeposit, setRedeposit, setRedepositTouched, t,
}: {
  combineLink: RecurringLinkResult | null
  pickedCand: { saving_id: string } | null
  setPickedSavingId: (v: string | null) => void
  interest: string
  setInterest: (v: string) => void
  principal: number
  iNum: number
  linkedAmt: number
  redeposit: string
  setRedeposit: (v: string) => void
  setRedepositTouched: (v: boolean) => void
  t: {
    whichRecurring: string
    pickHint: string
    interestReceived: string
    toAccount: string
    principalOut: string
    recurringThisMonth: string
    redepositAmount: string
    redepositHint: (amt: string) => string
  }
}) {
  return (
    <>
          {/* Which recurring to merge — shown when more than one is foldable, or
              when the match is ambiguous (so a loose single match stays opt-in,
              never auto-folded). */}
          {combineLink && (combineLink.candidates.length > 1 || combineLink.ambiguous) && (
            <div>
              <div style={fieldLabel}>{t.whichRecurring}</div>
              <div style={{ display: 'grid', gap: 7 }}>
                {combineLink.candidates.map((c) => {
                  const sel = pickedCand?.saving_id === c.saving_id
                  return (
                    <button key={c.saving_id} type="button" onClick={() => setPickedSavingId(sel ? null : c.saving_id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                        border: `1.5px solid ${sel ? 'var(--c-navy)' : 'var(--c-line)'}`, background: sel ? 'var(--c-navy-tint)' : 'var(--c-card)', fontFamily: 'inherit' }}>
                      {/* --c-btn-primary (not --c-navy) so the white check stays legible in dark mode — issue #264 */}
                      <span style={{ width: 18, height: 18, borderRadius: 9, flexShrink: 0, border: `1.5px solid ${sel ? 'var(--c-btn-primary)' : 'var(--c-line-strong)'}`, background: sel ? 'var(--c-btn-primary)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {sel && <Check size={11} color="#fff" strokeWidth={3} />}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600 }}>{c.name}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(c.amount_vnd)}</span>
                    </button>
                  )
                })}
              </div>
              {!pickedCand && <p style={{ margin: '7px 2px 0', fontSize: 11, color: 'var(--c-warn)', lineHeight: 1.45 }}>{t.pickHint}</p>}
            </div>
          )}

          <MoneyField label={t.interestReceived} value={interest} onChange={setInterest} />

          {/* Cash-flow recap — what lands in the account before re-depositing */}
          <div style={{ border: '1px solid var(--c-line)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '8px 13px', background: 'var(--c-card-2)', display: 'flex', alignItems: 'center', gap: 7 }}>
              <Wallet size={14} color="var(--c-muted)" />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--c-muted)' }}>{t.toAccount}</span>
            </div>
            <div style={{ padding: '10px 13px', display: 'grid', gap: 7 }}>
              {[
                { l: t.principalOut, v: principal, plus: false },
                { l: t.interestReceived, v: iNum, plus: true },
                { l: t.recurringThisMonth, v: linkedAmt, plus: true },
              ].map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                  <span style={{ color: 'var(--c-muted)' }}>{r.l}</span>
                  <span style={{ fontWeight: 600, color: r.plus ? 'var(--c-pos)' : 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>{r.plus ? '+' : ''}{fmt(r.v)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Re-deposit amount (suggested = principal + interest + recurring) */}
          <div>
            <div style={fieldLabel}>{t.redepositAmount}</div>
            <MoneyInputCore testId="maturity-redeposit" value={redeposit}
              onChange={(v) => { setRedeposit(v); setRedepositTouched(true) }}
              style={{ borderColor: 'var(--c-navy)' }} />
            <p style={{ margin: '7px 2px 0', fontSize: 11, color: 'var(--c-muted)', lineHeight: 1.45 }}>{t.redepositHint(fmtCompact(principal + iNum + linkedAmt))}</p>
          </div>
    </>
  )
}
