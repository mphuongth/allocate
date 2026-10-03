'use client'

// The renew-or-move decision for a maturing term deposit (#736 → this sheet).
//
// RenewOrMoveAdvisor: the user enters today's 12-month rate; at or above their
// threshold (Settings, default 8%) the sheet suggests renewing principal +
// interest, below it moving principal + interest into the deposit's target
// fund. It only suggests — the sheet preselects the option, the user confirms.
//
// MoveToFundSection: the move itself — which fund, what the bank paid out, the
// NAV the units are priced at. The units are an estimate until the order fills;
// the purchase is flagged so the user can correct it later.

import { fmt, fmtUnits } from '@/lib/formatters'
import { formatDecimalVN, parseDecimalVN } from '@/lib/numberFormat'
import { fieldLabel, moneyInput, MoneyField } from './maturityResolveFields'

export interface MoveFund { id: string; name: string; code: string | null; nav: number }

export const fundLabel = (f: MoveFund) => f.code || f.name

export function RenewOrMoveAdvisor({
  isVi, interestAtMaturity, threshold, currentRate, setCurrentRate, suggestion, targetFund, targetName,
}: {
  isVi: boolean
  interestAtMaturity: number
  threshold: number
  currentRate: string
  setCurrentRate: (v: string) => void
  suggestion: 'renew' | 'move' | null
  targetFund: MoveFund | null
  // A deposit parked for several funds has no single target: name them all.
  targetName?: string
}) {
  const fundName = targetName ?? (targetFund ? fundLabel(targetFund) : (isVi ? 'quỹ đích' : 'the target fund'))
  return (
    <div data-testid="renew-or-move" style={{ display: 'grid', gap: 10, padding: '12px 14px', border: '1px solid var(--c-line)', borderRadius: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{isVi ? 'Lãi khi đáo hạn' : 'Interest at maturity'}</span>
        <span data-testid="maturity-interest-at-maturity" style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-pos)', fontVariantNumeric: 'tabular-nums' }}>
          +{fmt(interestAtMaturity)}
        </span>
      </div>
      <div>
        <label htmlFor="maturity-current-rate" style={fieldLabel}>
          {isVi ? 'Lãi suất 12 tháng hiện tại' : "Today's 12-month rate"}
        </label>
        <div style={{ position: 'relative' }}>
          <input
            id="maturity-current-rate"
            type="text"
            inputMode="decimal"
            value={formatDecimalVN(currentRate)}
            onChange={(e) => setCurrentRate(parseDecimalVN(e.target.value))}
            placeholder="7,5"
            style={moneyInput}
          />
          <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--c-muted)', pointerEvents: 'none' }}>
            %/{isVi ? 'năm' : 'yr'}
          </span>
        </div>
        <p data-testid="maturity-threshold" style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--c-muted)', lineHeight: 1.4 }}>
          {isVi
            ? `Ngưỡng gửi lại của bạn: ${threshold}% (đổi trong Cài đặt).`
            : `Your renewal threshold: ${threshold}% (change it in Settings).`}
        </p>
      </div>
      {suggestion && (
        <p data-testid="maturity-suggestion" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--c-navy)', fontWeight: 600 }}>
          {suggestion === 'renew'
            ? (isVi ? `Gợi ý: tái tục gốc + lãi (lãi ≥ ${threshold}%).` : `Suggested: renew principal + interest (rate ≥ ${threshold}%).`)
            : (isVi ? `Gợi ý: chuyển gốc + lãi sang ${fundName} (lãi < ${threshold}%).` : `Suggested: move principal + interest to ${fundName} (rate < ${threshold}%).`)}
        </p>
      )}
    </div>
  )
}

export function MoveToFundSection({
  isVi, funds, fundId, setFundId, received, setReceived, nav, setNav, units,
}: {
  isVi: boolean
  funds: MoveFund[]
  fundId: string
  setFundId: (v: string) => void
  received: string
  setReceived: (v: string) => void
  nav: string
  setNav: (v: string) => void
  units: number | null
}) {
  const fund = funds.find((f) => f.id === fundId) ?? null
  return (
    <div data-testid="move-to-fund" style={{ display: 'grid', gap: 12 }}>
      <div>
        <label htmlFor="move-fund" style={fieldLabel}>{isVi ? 'Quỹ nhận tiền' : 'Fund to buy'}</label>
        <select id="move-fund" data-testid="move-fund-select" value={fundId} onChange={(e) => setFundId(e.target.value)} style={moneyInput}>
          <option value="">{isVi ? '— Chọn quỹ —' : '— Choose a fund —'}</option>
          {funds.map((f) => (
            <option key={f.id} value={f.id}>{f.code ? `${f.code} — ${f.name}` : f.name}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <MoneyField label={isVi ? 'Tiền thực nhận' : 'Cash received'} value={received} onChange={setReceived} testId="move-received" />
        <div>
          <label htmlFor="move-nav" style={fieldLabel}>NAV</label>
          <input id="move-nav" data-testid="move-nav" type="text" inputMode="decimal"
            value={formatDecimalVN(nav)} onChange={(e) => setNav(parseDecimalVN(e.target.value))} style={moneyInput} />
        </div>
      </div>
      <div style={{ padding: '10px 14px', background: 'var(--c-navy-tint)', borderRadius: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--c-navy)' }}>
          {isVi ? 'Số CCQ (ước tính)' : 'Units (estimated)'}{fund ? ` · ${fundLabel(fund)}` : ''}
        </span>
        <span data-testid="move-units" style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-navy)', fontVariantNumeric: 'tabular-nums' }}>
          {units != null ? fmtUnits(units) : '—'}
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--c-muted)', lineHeight: 1.45 }}>
        {isVi
          ? 'Sổ được tất toán và tiền mua quỹ, vẫn thuộc mục tiêu của sổ. Số CCQ tính theo NAV hiện tại — khi lệnh khớp, hãy sửa lại giao dịch mua cho đúng.'
          : 'The deposit is closed and the money buys the fund, staying in the deposit’s goal. Units are priced at today’s NAV — correct the purchase once the order fills.'}
      </p>
    </div>
  )
}

/** One fund of a move into several: its part of the payout, at its NAV. */
export interface MoveLeg {
  fund: MoveFund
  received: string
  nav: string
  units: number | null
}

// A deposit parked for several DCA lines goes back into all their funds: the
// total the bank paid, then one row per fund with its part (suggested from the
// share it put in, editable) and the units that part buys.
export function MultiMoveToFundSection({
  isVi, received, setReceived, legs, setLegReceived, setLegNav,
}: {
  isVi: boolean
  received: string
  setReceived: (v: string) => void
  legs: MoveLeg[]
  setLegReceived: (fundId: string, v: string) => void
  setLegNav: (fundId: string, v: string) => void
}) {
  const legsTotal = legs.reduce((sum, l) => sum + (Number(l.received) || 0), 0)
  const off = Math.round(legsTotal) !== Math.round(Number(received) || 0)
  return (
    <div data-testid="move-to-fund" style={{ display: 'grid', gap: 12 }}>
      <MoneyField label={isVi ? 'Tiền thực nhận' : 'Cash received'} value={received} onChange={setReceived} testId="move-received" />
      <div data-testid="move-legs" style={{ display: 'grid', gap: 8 }}>
        <div style={fieldLabel}>{isVi ? 'Chia vào các quỹ' : 'Split into the funds'}</div>
        {legs.map((l) => (
          <div key={l.fund.id} style={{ display: 'grid', gap: 6, padding: '10px 12px', border: '1px solid var(--c-line)', borderRadius: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{fundLabel(l.fund)}</span>
              <span data-testid={`move-leg-units-${l.fund.id}`} style={{ fontSize: 12, color: 'var(--c-navy)', fontVariantNumeric: 'tabular-nums' }}>
                {l.units != null ? `${fmtUnits(l.units)} ${isVi ? 'CCQ' : 'units'}` : '—'}
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 8 }}>
              <MoneyField label={isVi ? 'Số tiền' : 'Amount'} value={l.received} onChange={(v) => setLegReceived(l.fund.id, v)} testId={`move-leg-received-${l.fund.id}`} />
              <div>
                <label htmlFor={`move-leg-nav-${l.fund.id}`} style={fieldLabel}>NAV</label>
                <input id={`move-leg-nav-${l.fund.id}`} data-testid={`move-leg-nav-${l.fund.id}`} type="text" inputMode="decimal"
                  value={formatDecimalVN(l.nav)} onChange={(e) => setLegNav(l.fund.id, parseDecimalVN(e.target.value))} style={moneyInput} />
              </div>
            </div>
          </div>
        ))}
        {off && (
          <p data-testid="move-legs-off" style={{ margin: 0, fontSize: 11.5, color: 'var(--c-neg)', lineHeight: 1.4 }}>
            {isVi
              ? `Tổng các quỹ (${fmt(legsTotal)}) khác tiền thực nhận.`
              : `The funds add up to ${fmt(legsTotal)}, not the cash received.`}
          </p>
        )}
      </div>
      <p style={{ margin: 0, fontSize: 11, color: 'var(--c-muted)', lineHeight: 1.45 }}>
        {isVi
          ? 'Gợi ý chia theo phần DCA mỗi quỹ đã gửi vào sổ. Sổ được tất toán và tiền mua các quỹ, vẫn thuộc mục tiêu của sổ. Số CCQ tính theo NAV hiện tại — khi lệnh khớp, hãy sửa lại từng giao dịch mua.'
          : 'Suggested by each fund’s share of the deposit. The deposit is closed and the money buys the funds, staying in its goal. Units are priced at today’s NAV — correct each purchase once its order fills.'}
      </p>
    </div>
  )
}
