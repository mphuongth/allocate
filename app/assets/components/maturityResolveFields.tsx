'use client'

// Shared field primitives + the withdraw/hold workflow section for the
// maturity-resolve flow (#467). Split out of MaturityResolveSheet so the money
// fields and the hold-vs-cash fork live in a focused module; the sheet keeps the
// state and passes it in. The renew/combine sections still live in the sheet and
// import the field primitives from here.
import { PiggyBank, ArrowDownToLine, Check } from 'lucide-react'
import { fmt } from '@/lib/formatters'
import AmountInput from '@/app/components/ui/AmountInput'

export const fieldLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, letterSpacing: '0.05em',
  textTransform: 'uppercase', color: 'var(--c-muted)', marginBottom: 6,
}

export const moneyInput: React.CSSProperties = {
  display: 'block', width: '100%', boxSizing: 'border-box',
  padding: '10px 12px', fontFamily: 'inherit', fontSize: 16,
  fontVariantNumeric: 'tabular-nums', fontWeight: 600,
  background: 'var(--c-canvas,#faf9f7)', border: '1.5px solid var(--c-line)',
  borderRadius: 10, color: 'var(--c-ink)', outline: 'none',
}

export function MoneyInputCore({ value, onChange, testId, style, compact }: {
  value: string; onChange: (v: string) => void; testId?: string;
  style?: React.CSSProperties; compact?: boolean
}) {
  return (
    <div style={{ position: 'relative', ...(compact ? { flex: 1 } : null) }}>
      <AmountInput
        data-testid={testId}
        value={value}
        onChange={onChange}
        style={compact ? { ...moneyInput, padding: '7px 24px 7px 10px', fontSize: 16, ...style } : { ...moneyInput, ...style }}
      />
      <span style={{ position: 'absolute', right: compact ? 9 : 12, top: '50%', transform: 'translateY(-50%)', fontSize: compact ? 12 : 13, color: 'var(--c-muted)', pointerEvents: 'none' }}>₫</span>
    </div>
  )
}

export function MoneyField({ label, value, onChange, testId }: { label: string; value: string; onChange: (v: string) => void; testId?: string }) {
  return (
    <div>
      <div style={fieldLabel}>{label}</div>
      <MoneyInputCore value={value} onChange={onChange} testId={testId} />
    </div>
  )
}

// The withdraw resolution: an optional hold-vs-cash fork (when a later-maturing
// eligible anchor exists) plus the total payout. The sheet routes hold → the
// held-settlement write and cash → its existing Sell/Withdraw flow.
export function WithdrawSection({
  t, canHold, holdAnchor, holdChoice, setHoldChoice, holdReceived, setHoldReceived, payout,
}: {
  t: {
    holdForkPrompt: string
    holdCardTitle: string
    holdCardSub: (name: string) => string
    cashCardTitle: string
    cashCardSub: string
    holdReceivedLabel: string
    totalPayout: string
  }
  canHold: boolean
  holdAnchor: { name: string } | null
  holdChoice: 'hold' | 'cash'
  setHoldChoice: (v: 'hold' | 'cash') => void
  holdReceived: string
  setHoldReceived: (v: string) => void
  payout: number
}) {
  return (
        <div style={{ display: 'grid', gap: 12 }}>
          {/* Hold fork — only when a later-maturing eligible anchor exists. Two
              clear cards (hold preselected), per the owner's design. */}
          {canHold && holdAnchor && (
            <div data-testid="maturity-hold-fork" style={{ display: 'grid', gap: 8 }}>
              <div style={fieldLabel}>{t.holdForkPrompt}</div>
              {([
                { id: 'hold' as const, icon: <PiggyBank size={16} />, title: t.holdCardTitle, sub: t.holdCardSub(holdAnchor.name) },
                { id: 'cash' as const, icon: <ArrowDownToLine size={16} />, title: t.cashCardTitle, sub: t.cashCardSub },
              ]).map((c) => {
                const active = holdChoice === c.id
                const accent = c.id === 'cash' ? 'var(--c-neg)' : 'var(--c-navy)'
                return (
                  <button key={c.id} type="button" data-testid={`maturity-hold-card-${c.id}`} onClick={() => setHoldChoice(c.id)} style={{
                    width: '100%', textAlign: 'left', padding: '11px 12px',
                    background: active ? (c.id === 'cash' ? 'var(--c-neg-tint)' : 'var(--c-navy-tint)') : 'var(--c-card)',
                    border: `1.5px solid ${active ? accent : 'var(--c-line)'}`, borderRadius: 12, cursor: 'pointer',
                    fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 11,
                  }}>
                    <div style={{ width: 34, height: 34, borderRadius: 9, background: active ? 'var(--c-card)' : 'var(--c-card-2)', color: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{c.icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: active ? accent : 'var(--c-ink)' }}>{c.title}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--c-muted)', marginTop: 1, lineHeight: 1.4 }}>{c.sub}</div>
                    </div>
                    <div style={{ width: 18, height: 18, borderRadius: 9, border: `1.5px solid ${active ? accent : 'var(--c-line-strong)'}`, background: active ? accent : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {active && <Check size={11} strokeWidth={3} color="#fff" />}
                    </div>
                  </button>
                )
              })}
              {/* Cash received when holding — defaults to current value; edit down
                  if early settlement was penalised. */}
              {holdChoice === 'hold' && (
                <div style={{ paddingTop: 2 }}>
                  <MoneyField label={t.holdReceivedLabel} value={holdReceived} onChange={setHoldReceived} testId="maturity-hold-received" />
                </div>
              )}
            </div>
          )}

          <div style={{ border: '1px solid var(--c-line)', borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--c-card-2)' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-muted)' }}>{t.totalPayout}</span>
            <span style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(payout)}</span>
          </div>
        </div>
  )
}
