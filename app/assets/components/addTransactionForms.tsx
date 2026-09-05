'use client'

// The per-asset BUY form field sections for AddTransactionSheet (#467). Split out
// so each asset's inputs live in a focused component; the sheet keeps the
// orchestration (state, effects, dir/assetType gating, submit) and passes the
// relevant state down. Business math stays in addTransactionModel.ts.
import { useTranslations } from 'next-intl'
import { X, Wallet, TrendingUp, Building2, Coins, ArrowDownToLine, Shield } from 'lucide-react'
import { formatIntVN, parseIntVN, formatDecimalVN, parseDecimalVN } from '@/lib/numberFormat'
import LoadError from './LoadError'
import type { Fund, Bank, Holding } from './AddTransactionSheet'
import type { SellPreview, AssetType } from './addTransactionModel'
import { bankReceivedPrefill } from './addTransactionModel'

const GOLD_PROVIDERS = ['PNJ', 'DOJI', 'SJC', 'Bảo Tín']

export function BuyFundFields({
  funds, selectedFund, fundId, setFundId, amount, setAmount, units, setUnits,
  setNav, displayNav, navIsCurrent, autoUnits, navNum, inputStyle, labelStyle,
}: {
  funds: Fund[]
  selectedFund: Fund | undefined
  fundId: string
  setFundId: (v: string) => void
  amount: string
  setAmount: (v: string) => void
  units: string
  setUnits: (v: string) => void
  setNav: (v: string) => void
  displayNav: string
  navIsCurrent: boolean
  autoUnits: string
  navNum: number
  inputStyle: React.CSSProperties
  labelStyle: React.CSSProperties
}) {
  const t = useTranslations('addTx')
  return (
    <>
      <div>
        <label style={labelStyle}>{t('fund')}</label>
        <select
          value={fundId}
          onChange={(e) => { setFundId(e.target.value); setUnits(''); setNav('') }}
          style={{ ...inputStyle }}
        >
          {funds.map(f => (
            <option key={f.id} value={f.id}>
              {f.code ? `${f.code} — ` : ''}{f.name}
            </option>
          ))}
          {funds.length === 0 && <option value="">{t('noFunds')}</option>}
        </select>
        {selectedFund && (
          <div style={{ display: 'flex', gap: 12, margin: '5px 0 0', fontSize: 11, color: 'var(--c-muted)' }}>
            <span>NAV <strong style={{ color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>{selectedFund.nav.toLocaleString('vi-VN')} ₫</strong></span>
            {selectedFund.fund_type && <span style={{ textTransform: 'capitalize', color: 'var(--c-muted-2, var(--c-muted))' }}>{selectedFund.fund_type}</span>}
          </div>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr', gap: 10 }}>
        <div>
          <label style={labelStyle}>{t('amount')}</label>
          <input
            type="text"
            inputMode="numeric"
            value={formatIntVN(amount)}
            onChange={(e) => { setAmount(parseIntVN(e.target.value)); setUnits('') }}
            placeholder="5.000.000"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>{t('nav')}</label>
          <input
            data-testid="buy-fund-nav-input"
            type="text"
            inputMode="decimal"
            value={formatDecimalVN(displayNav)}
            onChange={(e) => { setNav(parseDecimalVN(e.target.value)); setUnits('') }}
            placeholder={selectedFund ? formatDecimalVN(String(selectedFund.nav)) : '0'}
            style={inputStyle}
          />
          {navIsCurrent && <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 4 }}>{t('navCurrent')}</div>}
        </div>
        <div>
          <label style={labelStyle}>{t('units')}</label>
          <input
            type="text"
            inputMode="decimal"
            value={formatDecimalVN(units || autoUnits || '')}
            onChange={(e) => { const v = parseDecimalVN(e.target.value); setUnits(v); setAmount(navNum > 0 && v ? String(Math.round(Number(v) * navNum)) : amount) }}
            placeholder={t('unitsAuto')}
            style={inputStyle}
          />
        </div>
      </div>
    </>
  )
}

export function BuyBankFields({
  banks, bankCode, setBankCode, depositType, setDepositType,
  bankAmount, setBankAmount, rate, setRate, maturity, setMaturity, topUpLockDays, setTopUpLockDays, date,
  lockType = false, inputStyle, labelStyle,
}: {
  banks: Bank[]
  bankCode: string
  setBankCode: (v: string) => void
  depositType: 'term' | 'flex' | 'accumulating'
  setDepositType: (v: 'term' | 'flex' | 'accumulating') => void
  bankAmount: string
  setBankAmount: (v: string) => void
  rate: string
  setRate: (v: string) => void
  maturity: string
  setMaturity: (v: string) => void
  topUpLockDays: string
  setTopUpLockDays: (v: string) => void
  date: string
  /** Editing a book: the savings type and its lock window are fixed — the PUT
   *  has no way to group or ungroup a deposit, so offering the switch would
   *  promise a change that silently never happens. */
  lockType?: boolean
  inputStyle: React.CSSProperties
  labelStyle: React.CSSProperties
}) {
  const t = useTranslations('addTx')
  return (
    <>
      {/* Structured bank (FK) — the deposit points at a real bank, and the
          chosen bank's name is the deposit's name (no separate name field).
          A general "note" further down covers any extra memo. */}
      <div>
        <label style={labelStyle}>{t('bank')}</label>
        <select
          data-testid="bank-select"
          value={bankCode}
          onChange={(e) => setBankCode(e.target.value)}
          style={inputStyle}
        >
          <option value="">{t('bankNone')}</option>
          {banks.map((b) => (
            <option key={b.code} value={b.code}>{b.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label style={labelStyle}>{t('depositType')}</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
          {(['term', 'accumulating', 'flex'] as const).map(opt => {
            const active = depositType === opt
            return (
              <button
                key={opt}
                type="button"
                data-testid={`deposit-type-${opt}`}
                aria-pressed={active}
                disabled={lockType && !active}
                onClick={() => setDepositType(opt)}
                style={{
                  padding: '9px 6px', borderRadius: 10,
                  background: active ? 'var(--c-navy-tint)' : 'var(--c-card-2)',
                  color: active ? 'var(--c-navy)' : 'var(--c-muted)',
                  border: `1px solid ${active ? 'var(--c-navy)' : 'var(--c-line)'}`,
                  opacity: lockType && !active ? 0.5 : 1,
                  cursor: lockType && !active ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                  fontSize: 12, fontWeight: 500, transition: 'all 120ms',
                }}
              >
                {opt === 'term' ? t('termDeposit') : opt === 'accumulating' ? t('accumulatingDeposit') : t('flexDeposit')}
              </button>
            )
          })}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: depositType !== 'flex' ? '1.2fr 1fr' : '1fr', gap: 10 }}>
        <div>
          <label style={labelStyle}>{t('principal')}</label>
          <input
            type="text"
            inputMode="numeric"
            value={formatIntVN(bankAmount)}
            onChange={(e) => setBankAmount(parseIntVN(e.target.value))}
            placeholder="10.000.000"
            style={inputStyle}
          />
        </div>
        {depositType !== 'flex' && (
          <div>
            <label style={labelStyle}>{t('rate')}</label>
            <input
              type="text"
              inputMode="decimal"
              value={formatDecimalVN(rate)}
              onChange={(e) => setRate(parseDecimalVN(e.target.value))}
              placeholder="5,5"
              style={inputStyle}
            />
          </div>
        )}
      </div>
      {depositType !== 'flex' && (
        <div>
          <label style={labelStyle}>{t('maturity')}</label>
          <input
            type="date"
            value={maturity}
            onChange={(e) => setMaturity(e.target.value)}
            style={inputStyle}
          />
        </div>
      )}
      {depositType === 'accumulating' && (
        <div>
          <label style={labelStyle}>{t('topUpLockDays')}</label>
          <input type="number" min="0" step="1" value={topUpLockDays} onChange={(e) => setTopUpLockDays(e.target.value)} disabled={lockType} placeholder="30" style={{ ...inputStyle, ...(lockType ? { opacity: 0.6 } : null) }} />
          <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 4 }}>{t('topUpLockHint')}</div>
        </div>
      )}
      {depositType !== 'flex' && Number(bankAmount) > 0 && Number(rate) > 0 && maturity && (() => {
        // Interest the user actually receives by maturity, prorated over
        // the term (deposit date → maturity) — not the full-year figure.
        const termDays = (Date.parse(maturity) - Date.parse(date)) / 86_400_000
        if (!(termDays > 0)) return null
        const interest = Math.round((Number(bankAmount) * Number(rate) / 100) * termDays / 365)
        return (
          <div style={{
            background: 'var(--c-pos-tint)', borderRadius: 10, padding: '9px 14px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: 12, color: 'var(--c-pos)', fontWeight: 500 }}>{t('estInterestReceivable')}</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-pos)', fontVariantNumeric: 'tabular-nums' }}>
              +{interest.toLocaleString('vi-VN')} ₫
            </span>
          </div>
        )
      })()}
    </>
  )
}

export function BuyGoldFields({
  goldProvider, setGoldProvider, goldUnit, setGoldUnit,
  goldQty, setGoldQty, goldPrice, setGoldPrice, inputStyle, labelStyle,
}: {
  goldProvider: string
  setGoldProvider: (v: string) => void
  goldUnit: 'chi' | 'luong'
  setGoldUnit: (v: 'chi' | 'luong') => void
  goldQty: string
  setGoldQty: (v: string) => void
  goldPrice: string
  setGoldPrice: (v: string) => void
  inputStyle: React.CSSProperties
  labelStyle: React.CSSProperties
}) {
  const t = useTranslations('addTx')
  return (
    <>
      <div>
        <label style={labelStyle}>{t('provider')}</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {GOLD_PROVIDERS.map(p => {
            const active = goldProvider === p
            return (
              <button
                key={p}
                type="button"
                onClick={() => setGoldProvider(p)}
                style={{
                  fontSize: 11, padding: '4px 9px', borderRadius: 999,
                  background: active ? 'rgba(180,83,9,0.08)' : 'var(--c-card-2)',
                  color: active ? '#b45309' : 'var(--c-muted)',
                  border: `1.5px solid ${active ? '#b45309' : 'transparent'}`,
                  cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                }}
              >
                {p}
              </button>
            )
          })}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <label style={labelStyle}>{t('unit')}</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {(['chi', 'luong'] as const).map((u) => {
              const active = goldUnit === u
              return (
                <button
                  key={u}
                  type="button"
                  onClick={() => {
                    // Keep the per-unit price consistent when switching:
                    // 1 lượng = 10 chỉ.
                    if (goldUnit !== u && goldPrice) {
                      const p = Number(goldPrice.replace(/[^0-9]/g, ''))
                      setGoldPrice(String(Math.round(p * (u === 'luong' ? 10 : 0.1))))
                    }
                    setGoldUnit(u)
                  }}
                  style={{
                    padding: '9px 4px', borderRadius: 8,
                    background: active ? 'rgba(180,83,9,0.10)' : 'var(--c-card-2)',
                    color: active ? '#b45309' : 'var(--c-muted)',
                    border: `1px solid ${active ? '#b45309' : 'var(--c-line)'}`,
                    cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: 13, fontWeight: 600, transition: 'all 120ms',
                  }}
                >
                  {u === 'chi' ? t('unitChi') : t('unitLuong')}
                </button>
              )
            })}
          </div>
        </div>
        <div>
          <label style={labelStyle}>{t('qty')}</label>
          <input
            type="text"
            inputMode="decimal"
            value={formatDecimalVN(goldQty)}
            onChange={(e) => setGoldQty(parseDecimalVN(e.target.value))}
            placeholder="1"
            style={inputStyle}
          />
        </div>
      </div>
      <div>
        <label style={labelStyle}>{goldUnit === 'chi' ? t('pricePerChi') : t('pricePerLuong')}</label>
        <input
          type="text"
          inputMode="numeric"
          value={formatIntVN(goldPrice)}
          onChange={(e) => setGoldPrice(parseIntVN(e.target.value))}
          placeholder="9.200.000"
          style={inputStyle}
        />
      </div>
      {goldQty && goldPrice && (
        <div style={{
          background: 'var(--c-card-2)', borderRadius: 10, padding: '9px 12px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 12, color: 'var(--c-muted)', fontWeight: 500 }}>{t('total')}</span>
          <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {(Number(goldQty) * Number(goldPrice.replace(/[^0-9]/g, ''))).toLocaleString('vi-VN')} ₫
          </span>
        </div>
      )}
    </>
  )
}

// The sell / withdraw workflow for AddTransactionSheet (#467): a shared
// holding-picker + amount shell with per-asset inserts (fund units, bank received,
// gold qty/price) and summaries. Renders from the full SellPreview the sheet
// computes; the sheet keeps the submit + payload logic.
export function SellForm({
  sell, assetType, isVI,
  holdingsError, setHoldingsError, setHoldingsReload,
  sellHoldings, selectedHolding, setHoldingKey,
  sellAmount, setSellAmount, fundSellUnits, setFundSellUnits,
  received, setReceived, goldSellQty, setGoldSellQty, goldSellPrice, setGoldSellPrice,
  inputStyle, labelStyle,
}: {
  sell: SellPreview
  assetType: AssetType
  isVI: boolean
  holdingsError: boolean
  setHoldingsError: (v: boolean) => void
  setHoldingsReload: (fn: (n: number) => number) => void
  sellHoldings: Holding[]
  selectedHolding: Holding | null
  setHoldingKey: (v: string) => void
  sellAmount: string
  setSellAmount: (v: string) => void
  fundSellUnits: string
  setFundSellUnits: (v: string) => void
  received: string
  setReceived: (v: string) => void
  goldSellQty: string
  setGoldSellQty: (v: string) => void
  goldSellPrice: string
  setGoldSellPrice: (v: string) => void
  inputStyle: React.CSSProperties
  labelStyle: React.CSSProperties
}) {
  const t = useTranslations('addTx')
  const {
    sellMax, numSell, sellOverMax, sellRemaining, sellNav, sellGainLoss, sellTax,
    numReceived, bankPctOfPrincipal, bankWithdrawPrincipal, bankGain,
    goldMaxUnits, numGoldSellQty, numGoldSellPrice, goldBuyUnit, goldProceeds, goldCost,
    goldProfit, goldRemUnits, isOverUnits,
  } = sell
  return (
            holdingsError ? (
              <div style={{ padding: '8px 16px', background: 'var(--c-card-2)', borderRadius: 12, border: '1px dashed var(--c-line)' }}>
                <LoadError isVI={isVI} onRetry={() => { setHoldingsError(false); setHoldingsReload((n) => n + 1) }} compact />
              </div>
            ) : sellHoldings.length === 0 ? (
              <div style={{ padding: '24px 16px', textAlign: 'center', background: 'var(--c-card-2)', borderRadius: 12, border: '1px dashed var(--c-line)' }}>
                <div style={{ width: 40, height: 40, borderRadius: 20, background: 'var(--c-card)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-muted)', marginBottom: 10 }}>
                  <Wallet size={18} />
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{t('noHoldings')}</div>
                <div style={{ fontSize: 11, color: 'var(--c-muted)', lineHeight: 1.5 }}>{t('switchToBuy')}</div>
              </div>
            ) : (
              <>
                <div>
                  <label style={labelStyle}>{t('pickHolding')}</label>
                  <select
                    value={selectedHolding?.key ?? ''}
                    onChange={(e) => { setHoldingKey(e.target.value); setSellAmount(''); setFundSellUnits(''); setReceived('') }}
                    style={inputStyle}
                  >
                    {sellHoldings.map(h => (
                      <option key={h.key} value={h.key}>
                        {h.name} · {h.currentValue.toLocaleString('vi-VN')} ₫ · {h.source}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedHolding && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: 'var(--c-card-2)', borderRadius: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--c-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: assetType === 'fund' ? '#2563eb' : assetType === 'bank' ? '#047857' : '#b45309', border: '1px solid var(--c-line)', flexShrink: 0 }}>
                      {assetType === 'fund' ? <TrendingUp size={18} /> : assetType === 'bank' ? <Building2 size={18} /> : <Coins size={18} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedHolding.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {/* Bank: what you can withdraw is the PRINCIPAL, so show
                            that as available and the value beside it — offering a
                            figure you can't enter is what made the old cap
                            misleading. */}
                        <span>{assetType === 'bank' ? t('principalAvailable') : t('available')}: <span style={{ fontWeight: 600, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>{Math.round(sellMax).toLocaleString('vi-VN')} ₫</span></span>
                        {assetType === 'bank' && <span>{t('valueShort')}: <span style={{ fontWeight: 600, color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>{selectedHolding.currentValue.toLocaleString('vi-VN')} ₫</span></span>}
                        {selectedHolding.units != null && <span style={{ fontVariantNumeric: 'tabular-nums' }}>{selectedHolding.units.toLocaleString('vi-VN')} {t('unitsShort')}</span>}
                        {assetType === 'bank' && selectedHolding.interestRate != null && <span>{selectedHolding.interestRate}%/yr</span>}
                      </div>
                    </div>
                  </div>
                )}

                {assetType !== 'gold' ? (
                  <>
                    <div>
                      {/* "Principal", explicitly: the field is the principal
                          leaving the book, not a share of its value (#578). */}
                      <label style={labelStyle}>{assetType === 'bank' ? t('principalToWithdraw') : t('amountToSell')}</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--c-card)', border: `1.5px solid ${sellOverMax ? 'var(--c-neg)' : 'var(--c-navy)'}`, borderRadius: 10 }}>
                          <span style={{ fontSize: 14, color: 'var(--c-muted)' }}>₫</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={formatIntVN(sellAmount)}
                            onChange={(e) => {
                              const v = parseIntVN(e.target.value)
                              setSellAmount(v)
                              const n = Number(v) || 0
                              if (assetType === 'fund') setFundSellUnits(sellNav && n ? (n / sellNav).toFixed(2) : '')
                              // The amount is principal, so the prefill adds the
                              // interest accrued on that slice back on top (#578).
                              if (assetType === 'bank') setReceived(n ? String(bankReceivedPrefill(selectedHolding, n)) : '')
                            }}
                            placeholder="0"
                            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', fontSize: 16, fontWeight: 600, fontFamily: 'inherit', background: 'transparent', color: sellOverMax ? 'var(--c-neg)' : 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}
                          />
                        </div>
                        <button type="button" onClick={() => {
                          setSellAmount(String(Math.round(sellMax)))
                          if (assetType === 'fund') setFundSellUnits(selectedHolding?.units != null ? selectedHolding.units.toFixed(2) : '')
                          if (assetType === 'bank') setReceived(String(bankReceivedPrefill(selectedHolding, sellMax)))
                        }} style={{ padding: '8px 12px', background: 'var(--c-navy-tint)', color: 'var(--c-navy)', border: '1px solid var(--c-navy-tint)', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' }}>{t('all')}</button>
                      </div>
                      {sellOverMax && (
                        <div style={{ fontSize: 11, color: 'var(--c-neg)', marginTop: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <X size={12} strokeWidth={2.5} /> {assetType === 'bank' ? t('exceedsPrincipal') : t('exceedsBalance')} · {t('max')} {Math.round(sellMax).toLocaleString('vi-VN')} ₫
                        </div>
                      )}
                    </div>

                    {/* Fund: units to sell, two-way linked with the amount above */}
                    {assetType === 'fund' && (
                      <div>
                        <label style={labelStyle}>{t('unitsToSell')}</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--c-card)', border: '1.5px solid var(--c-navy)', borderRadius: 10 }}>
                          <input
                            data-testid="sell-fund-units-input"
                            type="text"
                            inputMode="decimal"
                            value={formatDecimalVN(fundSellUnits)}
                            onChange={(e) => {
                              const v = parseDecimalVN(e.target.value)
                              setFundSellUnits(v)
                              const u = Number(v) || 0
                              setSellAmount(sellNav && u ? String(Math.round(u * sellNav)) : '')
                            }}
                            placeholder="0,00"
                            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', fontSize: 16, fontWeight: 600, fontFamily: 'inherit', background: 'transparent', color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}
                          />
                          <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{t('unitsShort')}</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 4 }}>{t('navLinkHint')}</div>
                      </div>
                    )}

                    {/* Bank: editable cash received (early withdrawal can cut interest) */}
                    {assetType === 'bank' && (
                      <div>
                        <label style={labelStyle}>{t('amountReceived')}</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--c-card)', border: '1.5px solid var(--c-navy)', borderRadius: 10 }}>
                          <span style={{ fontSize: 14, color: 'var(--c-muted)' }}>₫</span>
                          <input
                            data-testid="sell-bank-received-input"
                            type="text"
                            inputMode="numeric"
                            value={formatIntVN(received)}
                            onChange={(e) => setReceived(parseIntVN(e.target.value))}
                            placeholder="0"
                            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', fontSize: 16, fontWeight: 600, fontFamily: 'inherit', background: 'transparent', color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}
                          />
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 4 }}>{t('receivedHint')}</div>
                      </div>
                    )}

                    {/* Fund summary: remaining / gain-loss / tax */}
                    {assetType === 'fund' && numSell > 0 && !sellOverMax && (
                      <div style={{ background: 'var(--c-card-2)', borderRadius: 12, overflow: 'hidden' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--c-line)' }}>
                          <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{t('remainingAfter')}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{sellRemaining.toLocaleString('vi-VN')} ₫</span>
                        </div>
                        {sellGainLoss != null && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: sellTax ? '1px solid var(--c-line)' : 'none' }}>
                            <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{t('estGainLoss')}</span>
                            <span style={{ fontSize: 13, fontWeight: 600, color: sellGainLoss >= 0 ? 'var(--c-pos)' : 'var(--c-neg)', fontVariantNumeric: 'tabular-nums' }}>{sellGainLoss >= 0 ? '+' : ''}{Math.round(sellGainLoss).toLocaleString('vi-VN')} ₫</span>
                          </div>
                        )}
                        {sellTax != null && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px' }}>
                            <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{t('incomeTax')}</span>
                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-muted)', fontVariantNumeric: 'tabular-nums' }}>−{sellTax.toLocaleString('vi-VN')} ₫</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Bank summary: principal portion / received / gain-loss / remaining */}
                    {assetType === 'bank' && numSell > 0 && !sellOverMax && numReceived > 0 && (
                      <div style={{ background: 'var(--c-card-2)', borderRadius: 12, overflow: 'hidden' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--c-line)' }}>
                          <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{t('principalPortion')}{bankPctOfPrincipal < 0.999 && <span style={{ opacity: 0.7 }}> · {Math.round(bankPctOfPrincipal * 100)}%</span>}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{bankWithdrawPrincipal.toLocaleString('vi-VN')} ₫</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--c-line)' }}>
                          <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{t('amountReceived')}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{numReceived.toLocaleString('vi-VN')} ₫</span>
                        </div>
                        {bankGain != null && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 14px', borderBottom: '1px solid var(--c-line)' }}>
                            <span style={{ fontSize: 12, fontWeight: 600 }}>{t('gainLoss')}</span>
                            <span style={{ fontSize: 15, fontWeight: 700, color: bankGain >= 0 ? 'var(--c-pos)' : 'var(--c-neg)', fontVariantNumeric: 'tabular-nums' }}>{bankGain >= 0 ? '+' : '−'}{Math.abs(bankGain).toLocaleString('vi-VN')} ₫</span>
                          </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px' }}>
                          <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{t('remainingPrincipal')}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{sellRemaining.toLocaleString('vi-VN')} ₫</span>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {/* Gold: quantity (chỉ) to sell */}
                    <div>
                      <label style={labelStyle}>{t('quantityToSell')}</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--c-card)', border: `1.5px solid ${isOverUnits ? 'var(--c-neg)' : 'var(--c-navy)'}`, borderRadius: 10 }}>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={formatDecimalVN(goldSellQty)}
                            onChange={(e) => setGoldSellQty(parseDecimalVN(e.target.value))}
                            placeholder="0,00"
                            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', fontSize: 16, fontWeight: 600, fontFamily: 'inherit', background: 'transparent', color: isOverUnits ? 'var(--c-neg)' : 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}
                          />
                          <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{t('chiShort')}</span>
                        </div>
                        <button type="button" onClick={() => setGoldSellQty(String(goldMaxUnits))} style={{ padding: '8px 12px', background: 'var(--c-navy-tint)', color: 'var(--c-navy)', border: '1px solid var(--c-navy-tint)', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' }}>{t('all')}</button>
                      </div>
                      {isOverUnits && (
                        <div style={{ fontSize: 11, color: 'var(--c-neg)', marginTop: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <X size={12} strokeWidth={2.5} /> {t('exceedsQty')} · {t('max')} {goldMaxUnits} {t('chiShort')}
                        </div>
                      )}
                    </div>

                    {/* Gold: sale price per chỉ (prefilled with current price) */}
                    <div>
                      <label style={labelStyle}>{t('salePricePerChi')}</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--c-card)', border: '1px solid var(--c-line)', borderRadius: 10 }}>
                        <span style={{ fontSize: 14, color: 'var(--c-muted)' }}>₫</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={formatIntVN(goldSellPrice)}
                          onChange={(e) => setGoldSellPrice(parseIntVN(e.target.value))}
                          placeholder="0"
                          style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', fontSize: 16, fontWeight: 600, fontFamily: 'inherit', background: 'transparent', color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}
                        />
                        <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>/{t('chiShort')}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--c-muted)', marginTop: 4 }}>{t('salePriceHint')}</div>
                    </div>

                    {/* Gold summary: proceeds / cost / P&L / remaining */}
                    {numGoldSellQty > 0 && !isOverUnits && numGoldSellPrice > 0 && (
                      <div style={{ background: 'var(--c-card-2)', borderRadius: 12, overflow: 'hidden' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--c-line)' }}>
                          <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{t('totalReceived')}<span style={{ opacity: 0.7 }}> · {numGoldSellQty.toLocaleString('vi-VN')} {t('chiShort')} × {numGoldSellPrice.toLocaleString('vi-VN')}</span></span>
                          <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{goldProceeds.toLocaleString('vi-VN')} ₫</span>
                        </div>
                        {goldCost != null && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--c-line)' }}>
                            <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{t('yourCost')}{goldBuyUnit != null && <span style={{ opacity: 0.7 }}> · {numGoldSellQty.toLocaleString('vi-VN')} {t('chiShort')} × {goldBuyUnit.toLocaleString('vi-VN')}</span>}</span>
                            <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{goldCost.toLocaleString('vi-VN')} ₫</span>
                          </div>
                        )}
                        {goldProfit != null && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 14px', borderBottom: '1px solid var(--c-line)' }}>
                            <span style={{ fontSize: 12, fontWeight: 600 }}>{t('profitLoss')}</span>
                            <span style={{ fontSize: 15, fontWeight: 700, color: goldProfit >= 0 ? 'var(--c-pos)' : 'var(--c-neg)', fontVariantNumeric: 'tabular-nums' }}>{goldProfit >= 0 ? '+' : '−'}{Math.abs(goldProfit).toLocaleString('vi-VN')} ₫</span>
                          </div>
                        )}
                        {goldRemUnits != null && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px' }}>
                            <span style={{ fontSize: 12, color: 'var(--c-muted)' }}>{t('remainingAfter')}</span>
                            <span style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{Math.max(0, goldRemUnits).toLocaleString('vi-VN')} {t('chiShort')}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}

                {assetType === 'bank' && (
                  <div style={{ display: 'flex', gap: 10, padding: '10px 12px', background: 'var(--c-warn-tint)', borderRadius: 10, border: '1px solid rgba(180,83,9,0.15)' }}>
                    <Shield size={16} color="var(--c-warn)" style={{ flexShrink: 0, marginTop: 1 }} />
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--c-warn)', lineHeight: 1.5 }}>{t('earlyWithdrawWarn')}</p>
                  </div>
                )}

                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '9px 12px', background: 'var(--c-card-2)', borderRadius: 8 }}>
                    <Wallet size={14} color="var(--c-muted)" style={{ marginTop: 1, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: 'var(--c-muted)', lineHeight: 1.5 }}>{t('proceedsUnallocated')}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '9px 12px', background: 'var(--c-card-2)', borderRadius: 8 }}>
                    <ArrowDownToLine size={14} color="var(--c-muted)" style={{ marginTop: 1, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, color: 'var(--c-muted)', lineHeight: 1.5 }}>{assetType === 'fund' ? t('settlementFund') : assetType === 'bank' ? t('settlementBank') : t('settlementGold')}</span>
                  </div>
                </div>
              </>
            )
  )
}
