'use client'

// The merge-sibling-deposits sub-section of the combine flow (#467): pick sibling
// term deposits to settle early and fold into the re-deposit, with an eligibility
// window slider, per-source received inputs, an overall total, and a destination
// bank for a multi-source merge. Rendered only when the deposit isn't a book and
// eligible siblings exist (the sheet guards that). The sheet owns the state +
// classification + handlers and passes them in.
import { Check, Lock, SlidersHorizontal } from 'lucide-react'
import { fmtCompact } from '@/lib/formatters'
import type { InvRow } from './goalDetailShared'
import type { MergeClassification } from '@/lib/mergeEligibility'
import { fieldLabel, moneyInput, MoneyInputCore } from './maturityResolveFields'

export function MergeSourcesSection({
  mergeableOrdered, classOf, isSelected, toggleSource, overrideSource, blockReasonText,
  overridden, mergeRecv, setMergeRecv, setMergeTotal, setMergeTotalTouched, mergeTotal, onMergeTotalChange, isMultiSource,
  windowDays, setWindowDays, banks, destBank, setDestBank, selectedSources, mergeReceivedTotal,
  mergeSourceCount, mergeBankCount, t,
}: {
  mergeableOrdered: InvRow[]
  classOf: Map<string, MergeClassification>
  isSelected: (id: string) => boolean
  toggleSource: (s: InvRow) => void
  overrideSource: (s: InvRow) => void
  blockReasonText: (reason: MergeClassification['reason'], gapDays: number | null) => string
  overridden: Record<string, boolean>
  mergeRecv: Record<string, string>
  setMergeRecv: (updater: (prev: Record<string, string>) => Record<string, string>) => void
  setMergeTotal: (v: string) => void
  setMergeTotalTouched: (v: boolean) => void
  mergeTotal: string
  onMergeTotalChange: (v: string) => void
  isMultiSource: boolean
  windowDays: number
  setWindowDays: (v: number) => void
  banks: { code: string; name: string }[]
  destBank: string
  setDestBank: (v: string) => void
  selectedSources: InvRow[]
  mergeReceivedTotal: number
  mergeSourceCount: number
  mergeBankCount: number
  t: {
    mergeTitle: string; mergeTitleMulti: string; mergeHint: string
    windowLabel: (n: number) => string; windowHint: string
    mergeReceivedLabel: string; mergeTotalLabel: string; mergeEarly: string; mergePenalty: string
    provenance: (n: number, m: number) => string
    destBankLabel: string; destBankNone: string
  }
}) {
  return (
            <div style={{ border: '1px solid var(--c-line)', borderRadius: 12, padding: '11px 13px', display: 'grid', gap: 9 }}>
              <div>
                <div data-testid="merge-section-title" style={fieldLabel}>{isMultiSource ? t.mergeTitleMulti : t.mergeTitle}</div>
                <p style={{ margin: '0 0 2px', fontSize: 11, color: 'var(--c-muted)', lineHeight: 1.45 }}>{t.mergeHint}</p>
              </div>

              {/* Maturity window — widen to fold in farther-dated deposits (early
                  settlement). Re-runs the eligibility classification live. */}
              <div style={{ display: 'grid', gap: 5 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <SlidersHorizontal size={13} color="var(--c-muted)" style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--c-ink)' }}>{t.windowLabel(windowDays)}</span>
                </div>
                <input data-testid="merge-window-slider" type="range" min={1} max={90} value={windowDays}
                  onChange={(e) => setWindowDays(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--c-navy)' }} />
                <p style={{ margin: 0, fontSize: 10.5, color: 'var(--c-muted)', lineHeight: 1.4 }}>{t.windowHint}</p>
              </div>

              <div style={{ display: 'grid', gap: 7 }}>
                {mergeableOrdered.map((s) => {
                  const c = classOf.get(s.id)
                  const sel = isSelected(s.id)
                  // A blocked source the user hasn't (yet) folded in early.
                  const blocked = !!c && !c.eligible && !overridden[s.id] && !sel
                  if (blocked) {
                    return (
                      <div key={s.id} data-testid={`merge-source-${s.id}`}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 10,
                          border: '1.5px solid var(--c-line)', background: 'var(--c-card)', opacity: 0.7 }}>
                        <span style={{ width: 18, height: 18, borderRadius: 9, flexShrink: 0, border: '1.5px solid var(--c-line-strong)', background: 'var(--c-card-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Lock size={10} color="var(--c-muted)" />
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                          <div style={{ fontSize: 10.5, color: 'var(--c-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {blockReasonText(c!.reason, c!.maturityGapDays)}
                          </div>
                        </div>
                        {/* Out-of-window is overridable — "Gộp sớm?" folds it in despite
                            the window; a hard block (currency/pledged) just shows ₫ + lock. */}
                        {c!.overridable
                          ? <button type="button" data-testid={`merge-override-${s.id}`} onClick={() => overrideSource(s)}
                              style={{ fontSize: 11, fontWeight: 600, color: 'var(--c-warn)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, padding: 0 }}>
                              {t.mergeEarly}
                            </button>
                          : <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-muted)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(s.value ?? s.principal ?? 0)}</span>}
                      </div>
                    )
                  }
                  return (
                    <div key={s.id} style={{ display: 'grid', gap: 7 }}>
                      <button type="button" data-testid={`merge-source-${s.id}`} onClick={() => toggleSource(s)}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                          border: `1.5px solid ${sel ? 'var(--c-navy)' : 'var(--c-line)'}`, background: sel ? 'var(--c-navy-tint)' : 'var(--c-card)', fontFamily: 'inherit' }}>
                        <span style={{ width: 18, height: 18, borderRadius: 9, flexShrink: 0, border: `1.5px solid ${sel ? 'var(--c-btn-primary)' : 'var(--c-line-strong)'}`, background: sel ? 'var(--c-btn-primary)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {sel && <Check size={11} color="#fff" strokeWidth={3} />}
                        </span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                        {/* Mark a source folded in past its window so the early-settlement
                            risk stays visible after the override. */}
                        {overridden[s.id] && <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--c-warn)', flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t.mergeEarly}</span>}
                        <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtCompact(s.value ?? s.principal ?? 0)}</span>
                      </button>
                      {sel && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 28 }}>
                          <span style={{ fontSize: 11, color: 'var(--c-muted)', flexShrink: 0 }}>{t.mergeReceivedLabel}</span>
                          <MoneyInputCore compact testId={`merge-received-${s.id}`} value={mergeRecv[s.id] ?? ''}
                            onChange={(v) => { setMergeRecv((prev) => ({ ...prev, [s.id]: v })); setMergeTotal(''); setMergeTotalTouched(false) }} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {selectedSources.length > 0 && (
                <>
                  {/* Provenance — how many sources/banks fold into the new deposit */}
                  <p data-testid="merge-provenance" style={{ margin: 0, fontSize: 11, fontWeight: 600, color: 'var(--c-navy)', lineHeight: 1.45 }}>
                    {t.provenance(mergeSourceCount, mergeBankCount)}
                  </p>
                  {/* Destination bank for the combined re-deposit (default = D's bank) */}
                  <div>
                    <div style={fieldLabel}>{t.destBankLabel}</div>
                    <select data-testid="merge-dest-bank" value={destBank} onChange={(e) => setDestBank(e.target.value)} style={{ ...moneyInput, fontWeight: 600 }}>
                      <option value="">{t.destBankNone}</option>
                      {banks.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
                    </select>
                  </div>
                  {/* One editable TOTAL that splits across the selected sources */}
                  {selectedSources.length > 1 && (
                    <div>
                      <div style={fieldLabel}>{t.mergeTotalLabel}</div>
                      <MoneyInputCore testId="merge-total" value={mergeTotal === '' ? String(mergeReceivedTotal) : mergeTotal}
                        onChange={onMergeTotalChange} />
                    </div>
                  )}
                  {selectedSources.length === 1 && <input data-testid="merge-total" type="hidden" value={String(mergeReceivedTotal)} readOnly />}
                  <p data-testid="merge-penalty-caption" style={{ margin: 0, fontSize: 11, color: 'var(--c-warn)', lineHeight: 1.45 }}>{t.mergePenalty}</p>
                </>
              )}
            </div>
  )
}
