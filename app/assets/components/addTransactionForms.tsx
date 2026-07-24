'use client'

// The per-asset BUY form field sections for AddTransactionSheet (#467). Split out
// so each asset's inputs live in a focused component; the sheet keeps the
// orchestration (state, effects, dir/assetType gating, submit) and passes the
// relevant state down. Business math stays in addTransactionModel.ts.
import { useTranslations } from 'next-intl'
import { formatIntVN, parseIntVN, formatDecimalVN, parseDecimalVN } from '@/lib/numberFormat'
import type { Fund, Bank } from './AddTransactionSheet'

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
  bankAmount, setBankAmount, rate, setRate, maturity, setMaturity, date,
  inputStyle, labelStyle,
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
  date: string
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
                onClick={() => setDepositType(opt)}
                style={{
                  padding: '9px 6px', borderRadius: 10,
                  background: active ? 'var(--c-navy-tint)' : 'var(--c-card-2)',
                  color: active ? 'var(--c-navy)' : 'var(--c-muted)',
                  border: `1px solid ${active ? 'var(--c-navy)' : 'var(--c-line)'}`,
                  cursor: 'pointer', fontFamily: 'inherit',
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
